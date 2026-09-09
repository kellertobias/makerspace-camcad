# CAM G-code comparison bench

The bench imports a real DXF or SVG in Chromium, selects the configured contours, creates each operation through the
Operations ribbon, edits its fields through the Properties UI, downloads the generated G-code through the safety dialog,
and compares it with a reference file from another CAM system.

## Add a case

Copy `cases/example.bench.json.disabled` to a name ending in `.bench.json`, put the external CAM's G-code beside it, and
adjust the case. Contour indices are zero-based and follow the import order. Use `"all"` to target all contours. If a case
names a custom `toolId`, add its complete tool record to the top-level `tools` array; it is installed into the clean browser
library before the UI workflow.

Run all cases:

```bash
npx playwright install chromium # once per machine
npm run test:bench
```

Run one case from anywhere:

```bash
CAM_BENCH_CASE=/absolute/path/to/my-case.bench.json npm run test:bench
```

Supported operation settings mirror the app model: `name`, `toolId`, `depth`, `stepDown`, `side`, `entry`, `zOffset`,
`enabled`, `startT`, `startAngle`, `climb`, `feed`, `overcut`, `tabs`, `pocketSide`, `strategy`, `rasterAngle`,
`stepOverPct`, `outsideWidth`, `outsideWidthUnit`, drill `mode`/`peck`, thread `internal`/`majorD`/`pitch`/`passes`, and
laser settings. Automatic tabs are supported; coordinate-driven manual tabs and free drill points should be added to the
bench only when a stable UI interaction format has been agreed.

## What “equal” means

The comparison ignores:

- blank lines;
- parenthesised and semicolon comments;
- whitespace and letter case;
- numeric spelling only (`G01`, `G1`, `X10.0000`, and `X10` compare equal);
- optionally, leading `N` line numbers with `comparison.ignoreLineNumbers`.

It deliberately preserves block order, word order, coordinates (including zero-valued coordinates), feeds, spindle
speeds, tool changes, arc centres, and modal command omissions. This makes it a strong regression oracle when both CAM
systems use equivalent post-processors. It is not a general proof of machining equivalence: two safe programs may use
different start points, arc splitting, direction, coordinate modes, canned cycles, or modal repetition and fail this
comparison. Conversely, text equality cannot prove that the selected tool, work offset, stock, clamping, or machine setup
is safe. Review and simulate every program before it reaches a machine.
