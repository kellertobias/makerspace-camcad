# Makerspace CAM (cnc-milling-calc)

Browser-based 2.5D CAM for the Makerspace machines: import DXF/SVG outlines, lay them out on a sheet, assign
operations (contour, cutout with bridges, pocket, engraving, drilling), preview toolpaths and generate G-code through
data-driven post-processor profiles. Fully static (Next.js `output: 'export'`), no server. The original cutting-data
calculator lives on at `/calc/` and is embedded in the tool editor.

## Run

```bash
npm install
npm run dev        # development
npm run build      # static export to out/
npm start          # serve out/
npm test           # vitest (geometry, CAM, post-processor)
```

## Layout

```
app/            page.tsx (CAM), calc/page.tsx (calculator)
components/     shell (ribbon, tree, status, G-code view), canvas2d, panels, modals, ui, calc
lib/model       project document model (shapes, placements, groups, stock, tools, machines, operations)
lib/geometry    paths with arcs, transforms, arc refit, offsetting (clipper-lib), containment
lib/import      DXF (dxf-parser), SVG (DOMParser), joining/orientation
lib/cam         planner: depth passes, ramp/helix entries, contour/cutout/tabs/pocket/drill, zero point, time estimate
lib/post        Estlcam-compatible post-processor emitter, .pp import/export, built-in profiles
lib/store       zustand stores (project with undo/redo, UI, machine/tool/profile library), actions
lib/persist     File System Access API with download fallback
public/samples  example drawings
tests/          unit tests and the Estlcam golden files (holzcncv12.pp, namensschild.nc)
```

## Post-processors

Profiles mirror Estlcam's `.pp` format (word order, repeat flags, arcs on/off, I/J relative, header/footer/tool change
blocks) and can be imported from `.pp` files in *Options → Post-processors*. Built-ins: Makerspace Holz CNC (Estlcam V12),
generic GRBL mill, generic GRBL laser, IMA BIMA placeholder (the IMA is programmed via IMAWOP FMC files; exporter pending).

## Status

Done: shell (ribbon, tree, 2D canvas, parameter panel, G-code view), DXF/SVG import, placement (move/rotate/mirror/array/group),
contour outside/inside/on/left/right, cutout with bridges, pocket (offset + raster), engraving, drilling, dog-bone/T-bone,
start point/angle, zero-point modes, undo/redo, project save/open (`.cncproj`), autosave, tool/machine/profile library.

Pending: 3D preview and material simulation, text engraving (fonts), laser operations end-to-end + SVG export,
thread milling, saw blades, IMA FMC exporter, IndexedDB project cache, worker offloading.
