import { decodeServerMessage, type ServerMessage } from '@astra/shared/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { CloseCode, MAX_BUFFERED_BYTES, REFUSE_GRACE_MS, Session, SessionRegistry, type SessionSocket } from './session.ts';

class FakeSocket implements SessionSocket {
  readyState: SessionSocket['readyState'] = WebSocket.OPEN;
  bufferedAmount = 0;
  sent: string[] = [];
  closed: { code?: number; reason?: string } | null = null;
  terminated = false;
  pongs = 0;
  send(data: unknown) {
    this.sent.push(String(data));
  }
  pong() {
    this.pongs++;
  }
  close(code?: number, reason?: string | Buffer) {
    this.closed = { code, reason: String(reason) };
    this.readyState = WebSocket.CLOSING;
  }
  terminate() {
    this.terminated = true;
    this.readyState = WebSocket.CLOSED;
  }
}

const pong: ServerMessage = { t: 'pong', id: 1, clientTime: 2, serverTime: 3 };

afterEach(() => {
  vi.useRealTimers();
});

describe('Session', () => {
  it('sends validated messages with only the schema fields', () => {
    const sock = new FakeSocket();
    const s = new Session(1, sock, '127.0.0.1');
    s.send({ ...pong, secret: 'server-only' } as ServerMessage);
    expect(sock.sent).toHaveLength(1);
    expect(JSON.parse(sock.sent[0]!)).toEqual(pong);
  });

  it('refuses to send an invalid message', () => {
    const s = new Session(1, new FakeSocket(), '127.0.0.1');
    expect(() => s.send({ ...pong, id: -1 })).toThrow();
  });

  it('drops a client whose outbound queue passes 1 MiB instead of buffering more', () => {
    const sock = new FakeSocket();
    const s = new Session(1, sock, '127.0.0.1');
    sock.bufferedAmount = MAX_BUFFERED_BYTES;
    s.send(pong);
    expect(sock.sent).toHaveLength(1);
    sock.bufferedAmount = MAX_BUFFERED_BYTES + 1;
    s.send(pong);
    expect(sock.sent).toHaveLength(1);
    expect(sock.terminated).toBe(true);
    expect(s.state).toBe('closed');
    expect(s.endReason).toBe('outbound buffer full');
  });

  it('answers pings only while the outbound queue is under 1 MiB', () => {
    const sock = new FakeSocket();
    const s = new Session(1, sock, '127.0.0.1');
    s.pong(Buffer.from('x'));
    expect(sock.pongs).toBe(1);
    sock.bufferedAmount = MAX_BUFFERED_BYTES + 1;
    s.pong(Buffer.from('x'));
    expect(sock.pongs).toBe(1);
    expect(sock.terminated).toBe(true);
    s.pong(Buffer.from('x'));
    expect(sock.pongs).toBe(1);
  });

  it('refuses with a message and a close, then cuts the socket off after the grace period', () => {
    vi.useFakeTimers();
    const sock = new FakeSocket();
    const s = new Session(1, sock, '127.0.0.1');
    s.refuse('auth', 'x'.repeat(400));
    const msg = decodeServerMessage(sock.sent[0]!);
    expect(msg).toMatchObject({ t: 'refused', code: 'auth' });
    expect(msg?.t === 'refused' && msg.reason.length).toBe(280);
    expect(sock.closed).toEqual({ code: CloseCode.refused, reason: 'auth' });
    expect(s.state).toBe('closed');
    s.refuse('invalid', 'again');
    expect(sock.sent).toHaveLength(1);
    expect(sock.terminated).toBe(false);
    vi.advanceTimersByTime(REFUSE_GRACE_MS);
    expect(sock.terminated).toBe(true);
  });

  it('refusing a client that is not reading just cuts it off', () => {
    const sock = new FakeSocket();
    sock.bufferedAmount = MAX_BUFFERED_BYTES + 1;
    const s = new Session(1, sock, '127.0.0.1');
    s.refuse('invalid', 'Too many messages.');
    expect(sock.sent).toEqual([]);
    expect(sock.closed).toBeNull();
    expect(sock.terminated).toBe(true);
  });
});

describe('SessionRegistry', () => {
  it('counts sessions per account and forgets them on removal', () => {
    const r = new SessionRegistry();
    const a = new Session(1, new FakeSocket(), 'ip');
    const b = new Session(2, new FakeSocket(), 'ip');
    for (const s of [a, b]) {
      r.add(s);
      r.bindAccount(s, 'acct');
    }
    expect(r.countForAccount('acct')).toBe(2);
    r.remove(a);
    expect(r.countForAccount('acct')).toBe(1);
    r.remove(b);
    expect(r.countForAccount('acct')).toBe(0);
    expect(r.size).toBe(0);
  });

  it('lists an account’s open sessions oldest first, leaving out closed ones before their socket goes', () => {
    const r = new SessionRegistry();
    const [a, b, c] = [1, 2, 3].map((id) => new Session(id, new FakeSocket(), 'ip'));
    for (const s of [a!, b!, c!]) {
      r.add(s);
      r.bindAccount(s, 'acct');
    }
    expect(r.openForAccount('acct')).toEqual([a, b, c]);
    a!.refuse('kicked', 'oldest');
    expect(r.openForAccount('acct')).toEqual([b, c]);
    expect(r.countForAccount('acct')).toBe(2);
  });

  it('hands back the older session holding a character', () => {
    const r = new SessionRegistry();
    const a = new Session(1, new FakeSocket(), 'ip');
    const b = new Session(2, new FakeSocket(), 'ip');
    expect(r.bindCharacter(a, 'c1')).toBeUndefined();
    expect(r.bindCharacter(b, 'c1')).toBe(a);
    r.remove(a); // the kicked session closing must not unbind the new holder
    expect(r.bindCharacter(a, 'c1')).toBe(b);
  });
});
