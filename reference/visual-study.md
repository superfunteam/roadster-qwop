# Reference study

## Sources

User-provided `roadstar-demo.mp4`: 48.576 seconds, 1286 × 720, 60 fps. Original video and photos are preserved in the repository root.

Photos examined: `front.jpg`, `side.jpeg`, `front-side.avif`, `back.avif`, `back-blast.avif`, `boosters.avif`. AVIF previews live in this directory.

## Frame sampling

- `contact-01.jpg` / `contact-02.jpg`: full video at one frame every two seconds, in playback order.
- `flip.jpg`: 6–18 seconds at two frames per second, six columns, left to right then top to bottom.
- `ramp-01.jpg` / `ramp-02.jpg`: 26–38 seconds at four frames per second, six columns.

## Observed motion and design implications

- Around 6–12 s: a forceful upward burst, distinct airborne rotation and a cloud of expelled gas. The car keeps rotating after the burst. Use off-center forces and retained angular momentum, not scripted spin animations.
- Around 13–18 s: the vehicle follows the upper return curve upside down, leaves the edge, rotates and descends. The game uses a genuinely collidable semicircular ramp and an inverted departure; the player controls the free-flight recovery.
- Around 26–35 s: very large white plumes accompany the stunt. Blue-white nozzle cores expand into soft vapor rather than orange combustion trails.
- Around 36–38 s: a clear wide shot shows a tall, open vertical return curve with red edge lighting and external steel supports. It is not a closed loop or a flat skate half-pipe.
- The footage is not sufficient to infer actual mass, thrust or control-system behavior. Gameplay values are explicitly tuned assumptions.

## Car geometry

The supplied new prototype is angular: a broad wedge nose, planar silver fenders, triangular front lamps beside a continuous thin white light strip, black glass canopy, low body and large wheels. The rear has a broad elevated wing with endplates, a continuous red light blade and four circular nozzles across a dark diffuser. Four additional downward nozzles sit near the wheel stations. The procedural mesh follows these details instead of using the older rounded Roadster silhouette.

The model uses metres and +Z forward. Wheelbase is 2.86 m, wheel radius .36 m, overall shell length approximately 4.65 m. These are modeling choices from visual proportion, not measured manufacturer dimensions.

## Tuning evidence

All four balanced jets lift the car; individual jets generate pitch and roll. Tire forces are separate from airborne jet control. A rendered real-time keyboard test completed the inversion with zero damage: front-jet pulse after launch, rear-jet correction, four-jet landing cushion. Stable landing checks prevent a fast downward impact from scoring a win before damage is applied.

Desktop and mobile landscape/portrait screenshots were reviewed for car visibility, menus and controls. The camera was lowered and aimed closer to the car after early HUD occlusion. The windshield glare, front fascia, wheel spokes, roof cutaway and ramp light placement were corrected from rendered views.
