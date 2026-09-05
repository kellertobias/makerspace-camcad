let's expand the capabilities of this application.

i want the ability to layout one or multiple outlines (place one or multiple CAD sketches) and then select the outlines and decide how these are milled (or lasered).

We need to support multiple machines, our 2 Wood CNC machines, our Metal CNC, our 2 Lasers (that can cut and engrave). In the end we need to generate the GCODE for these machines.

for CNC, we need to support:

Defining the Tools (Milling bits, with assistant support to calculate the numbers; Drilling bits, saw blades for the IMA)
Loading DXF and SVG files and placing them (mirroring, rotating)
Defining arrays for producing multiple equal parts
Selecting contours, shape centers, line centers and then decide how they are manufactured
Selecting cutting outside or inside or on the selected closed contour
Selecting cutting/ engraving left, on or right of a selected open or closed contour
milling pockets or islands
milling cutouts with or without connecting bridges
selecting at which point a cutout or pocket is started
selecting at which angle things are started
selecting over milling, so that sharp inner edges have milled more material
placing of text for engraving
setting the zero point (and auto-setting the zero point)
milling preview in 3d with and without the tool; 3d preview of the finished milled product (mdf, osb, multiplex, regular wood and aliminium optic)
selecting points for drilling or threading

The files must be stored on the user's device and cached in local storage

the UI should be the following:

Ribbon menu for editing selection
tree view on the left (with the selected tool as the first node and then the objects milled with that tool as child nodes. Group support)
ability to group multiple objects, so that they can be edited together (e.g. shifted in z-axis)
info/ parameter view on the right side
options menu/ modal for configuring the mill and tools/ bits


----

see the attached files. the e12 and nc are the esticam files for a test milling, the pp is the "Makerspace Holz CNC" profile for esticam. I do not yet have the other profiles, but we need to be flexible in generating different gcode for different machines.

<internal git server> this is the code for converting Esticam to the IMA BIMA CAD

----

please make sure I can select contours and do not select everything within the same dxf/svg file

----

i need to be able to delete edits from the tree.

----

Make sure that I can select for a pocket wether I want it outside, inside or on the contour (outside works like contour outside, then pocket). In all cases, I want a clean pass on the contour and then with the "seitliche zustellung" the strategy within the pocket.

----

for all of the editing sidebar, please show little diagrams of what the values mean, e.g. Tiefe, Zustellung, Z-Versatz, Eintauchen can be shown in one little diagram

----

z offset should be the actual start depth of the milling (e.g. I am plaining from z=0 to z=2, then start cutting a groove with start = 2mm, depth = 3mm brings z to 5mm

----

make sure the machine can define wether climb milling is allowed at all. Default for wood CNC must be climb milling not allowed.

----

for pocket: the wall pass outside should not be a "fully outside", but simply can decide how many tool widths or mm of extra material removed around the contour we want

----

make sure that by default the operations are created in the order I am defining them, not necessarily by tool. I might want to mill large areas with the 6mm tool and then in the end cut the piece free with the 6mm but have it attached in between.

also allow me to drag and drop reorder the operations.

For the UI: The Main Tree Level is the selected tool, then I ONLY see one line per operation. this line contains the Name of the Operation (the one we gave it), an icon for the operation type and maybe how many paths

----

allow me to close sections on the right side. By default all sections beside the main section is closed.

Move tart position and start angle and feed overrides into their own sections.

----

at the top of the "operations" list I want a "Stock/ Sheet" option that I can click to define my material, safe z, thickness.

for the pocket: the "outside" option only defines, where the first pass is happening, outside of the contour, on the contour, inside of the contour. For "outside", i want how much material is removed outside of the contour. This is for creating safe zones around the material for other tools. we always cut out the full inside as well. In all cases: The pretty/ contour pass must have some but not full overlap with the actual inner cutout where we use the strategy to get rid of the material

Exception here is if we define contours as exclusion zones. For each of these we need to be able to configure the pocket behavior as well. (eg. plain the full material, except for 2 places where we have mounted the material with safe zones around that, or milling a pocket except for 2 standoffs that should stay)

for the cutout bridges: I need to be able to explicitly place them in the 2d view or select "place automatically". for automatically placing,. we place first on opposite sides where the material is not round, of that isn't possible, we try any position for auto.


----

for the view: I want 3 view options for 2d:

milling (where we color the milled areas by type of operation)
tool paths (show the actual paths)
rapids (show the dotted movements)

----

commit this & continue with 3d

----

we please update the three d wood path more often? ideally, it needs to update directly behind of the tool. when it moves.

----

in the "Operations sidebar", I want to see the start start and maximum z depth for each operation

----

we need an additional pocket strategy: zig-zag. that is side down side down

----

when I have an operation selected, all other operations must only 50% of its original opacity

----

when I have changed a value and click outside (which deselects the operation), make sure the change gets saved.

----

make sure my view settings get saved in the browser

----

for 3d preview:
please make sure that when I have cuth through my material (e.g. made a 12mm cut in a 12mm material) the floor is always blue.

If I have cut any deeper than my material, that area is shown red

----

for the preview: please have at least a resolution of 0.1mm and make sure that for layered wood I see the layers on the inside/ where cuts are.

----

last but not least, I need the ability to add font paths (in the layout view) so that I can then e.g. carve them.

When selecting the font, I must choose the tool already, because for the font path, the tool size must be considered

----

when I have selected an operation, make sure that the milling and tool paths of all other operations are muted/ less opaque. Only my selected operation should be fully visible.

----

for "engrave", "drill" and "thread", I also want a start depth.

----

plaining mill bits seem to not be able to be produced.

Please make sure that we have some diagrams for the parameters when creating the tools

----

make sure that a ramp angle of 90 degrees works (=no ramping)

also make sure that we optimize the path: when we mill a full outline, we do not need to move backwards first if on the second pass we would then clear out the remaining material of the ramp.

----

for the pocket milling, can we move from one round trip to the next one without changing z-axis? there should be no need to re-ramp over and over

----

everywhere where we can export gcode, please add a warning that this tool is considererd a "custom gcode generator" and you use at your own risk. Even though we have checked some of the generated gcode, no software is bug free, especially for software that is generating gcode (which is not really standardized) you need to keep the machine in view all the time and emergency stop (not aus) it as soon as you see any problem.

-----

i need another feature: selecting points (e.g. for placing a drilling or thread, placing a bridge).
The points that should automatically snap are:
- centers of lines (or line segments)
- 1/3rd and 2/3rd points
- 1/4th, 3/4th points

Especially for drillings and threads as well:
- centers of contours shapes
- the midway point between two points (however long to show a dotted line between them: hover first, gets highlighted, wait, hover second, gets highlighted, wait, dotted line appears. I now can place on that line on 1/4, 2/4, 3/4, 2/3, 2/3 points)

----

for our Gcode viewer, I want a feature, that shows me per line of gcode what it actually does for this specific machine.. I want also to be able to paste custom gcode and let it tell me
