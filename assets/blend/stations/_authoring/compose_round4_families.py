"""Refresh only changed family rows; preserve bound unchanged rows and standard cell dimensions.

Run: uv run --no-project --with Pillow==12.0.0 python <this script>
"""
import hashlib
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[4]
BASE = ROOT / "assets/renders/stations/round4"
STATIC = BASE / "current/static"
bindings = {r["kit"]: r for r in json.loads((BASE / "export_module_bindings_final.json").read_text())}


def item(path):
    return {"path": str(path.relative_to(ROOT)), "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "bytes": path.stat().st_size}


reports = []
for kit, target in (("waystation", "ws_fabricator"), ("scrapyard", "sy_rock")):
    old_manifest = ROOT / f"assets/renders/stations/round3/static/{kit}_family_manifest.json"
    manifest = json.loads(old_manifest.read_text())
    rows = manifest["family"]["rows"]
    index = next(i for i, r in enumerate(rows) if r["target"][0] == target)
    fresh_row = json.loads((STATIC / f"{kit}_{target}_family_row.json").read_text())
    header_path = STATIC / f"{kit}_{target}_family_header.png"
    turntable_path = STATIC / f"{kit}_{target}_turntable.png"
    with Image.open(turntable_path) as image:
        assert image.size == (3200, 1200)
        cells = []
        for angle in (0, 2, 4, 6):
            x, y = angle % 4 * 800, angle // 4 * 600
            cells.append(image.crop((x, y, x + 800, y + 600)).resize((480, 360), Image.Resampling.LANCZOS))
    header = Image.open(header_path).convert("RGBA")
    assert header.size == (1920, 48)
    new_paths = []
    retained_rows = []
    for page, original in enumerate(manifest["family"]["sheets"]):
        old = Path(original)
        if not old.is_absolute():
            old = ROOT / old
        with Image.open(old) as previous:
            current = previous.convert("RGBA")
            assert current.width == 1920
            for local in range(current.height // 408):
                row_index = page * 6 + local
                if row_index == index:
                    y = local * 408
                    current.paste(header, (0, y))
                    for k, cell in enumerate(cells):
                        current.paste(cell, (k * 480, y + 48))
                else:
                    module = rows[row_index]["target"][0]
                    proof = next(m for m in bindings[kit]["modules"] if m["module"] == module)
                    assert proof["exact_export_module_match"]
                    prior_pixels = previous.crop((0, local * 408, 1920, (local + 1) * 408)).convert("RGBA").tobytes()
                    current_pixels = current.crop((0, local * 408, 1920, (local + 1) * 408)).tobytes()
                    assert current_pixels == prior_pixels
                    retained_rows.append({"module": module, "pixel_sha256": hashlib.sha256(current_pixels).hexdigest(),
                                          "module_fingerprint": proof["current_fingerprint"], "previous_sheet": item(old)})
            output = STATIC / old.name
            assert not output.exists()
            current.save(output)
        new_paths.append(output)
    rows[index] = fresh_row
    text_path = STATIC / f"{kit}_family.txt"
    text_path.write_text("\n".join(f'{new_paths[i // 6].name} row {i % 6 + 1}: {r["text"]}' for i, r in enumerate(rows)) + "\n")
    manifest["source"] = str(ROOT / bindings[kit]["current_export"]["path"])
    manifest["family"] = {"sheets": [str(p) for p in new_paths], "list": str(text_path), "rows": rows}
    manifest["composition"] = {"changed_row": target, "fresh_turntable": item(turntable_path), "fresh_standard_header": item(header_path),
                               "view_angles_degrees": [22.5, 112.5, 202.5, 292.5], "elevation_degrees": 20,
                               "source_cell_pixels": [800, 600], "standard_family_cell_pixels": [480, 360],
                               "filter": "Lanczos supersample downfilter to unchanged standard family cell dimensions",
                               "unchanged_rows": retained_rows}
    out_manifest = STATIC / f"{kit}_family_manifest.json"
    out_manifest.write_text(json.dumps(manifest, indent=2) + "\n")
    reports.append({"kit": kit, "manifest": item(out_manifest), "outputs": [item(p) for p in new_paths + [text_path]],
                    "unchanged_rows_reused_exact": len(retained_rows), "new_row": target})
(BASE / "family_composition_bindings.json").write_text(json.dumps(reports, indent=2) + "\n")
print("FAMILY SHEETS REFRESHED", reports)
