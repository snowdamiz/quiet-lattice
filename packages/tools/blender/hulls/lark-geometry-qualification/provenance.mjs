import {sub} from './geometry.mjs';
export function inversePoint(p,m) {
  const a=m[0],b=m[4],c=m[8],d=m[1],e=m[5],f=m[9],g=m[2],h=m[6],i=m[10];
  const det=a*(e*i-f*h)-b*(d*i-f*g)+c*(d*h-e*g);if(Math.abs(det)<1e-20)throw Error('Singular world matrix');
  const [x,y,z]=sub(p,m.slice(12,15));
  return [((e*i-f*h)*x+(c*h-b*i)*y+(b*f-c*e)*z)/det,((f*g-d*i)*x+(a*i-c*g)*y+(c*d-a*f)*z)/det,((d*h-e*g)*x+(b*g-a*h)*y+(a*e-b*d)*z)/det];
}
// Signed quantBits=13, then replicate most significant bits to unused low bits.
// This matches the inspected pinned glTF-Transform 4.5.1 quantizeAttribute.
export function quantize14(v){const q=Math.round(Math.min(1,Math.abs(v))*8191);return Math.sign(v)*((q<<2)|(q>>11));}
export const sourceCode=(p,world)=>inversePoint(p,world).map(quantize14).join(',');
export const decodedCode=(p,world)=>inversePoint(p,world).map(x=>Math.round(x*32767)).join(',');
