# ROADSTER — But can it fly?

A browser-based 3D rocket-driving game. Four independently controlled thrusters, a heavy car, and three increasingly unreasonable flight tests.

## Run locally

Requires Node 22+.

```sh
npm ci
npm run dev
```

Open the URL printed by Vite. Use the keyboard on desktop, or the two thumb controls on phones and tablets. Landscape gives the widest view.

## Controls

| Input | Action |
| --- | --- |
| Q / W | Front-left / front-right vertical thruster |
| O / P | Rear-left / rear-right vertical thruster |
| Space | Rear-facing thrust |
| ↑ / ↓ | Drive / brake, then reverse |
| ← / → | Ground steering |
| R | Reset car and all props |
| C | Cycle chase / trackside / close camera |
| Esc | Pause / resume |
| M | Mute / unmute |

Hold a thruster to build pressure. Its thrust ramps up and decays after release. Front jets raise the nose, rear jets raise the tail, and left/right imbalance creates roll. All four lift the vehicle. Momentum continues after releasing the keys. Thrust follows the car's orientation, including when inverted. Pressure recharges when the jets are released.

If the car settles on its roof, a short countdown automatically restarts the test. Moving, rolling, or righting the car cancels recovery; airborne inversions and the upside-down ramp remain playable. Pause freezes the countdown, and held controls must be released before they can fire again after a restart.

On phones and tablets, portrait and landscape are both supported, including in the installed app. The interface respects notches and home indicators, adapts to browser toolbar changes, and releases held controls when the screen rotates. Menus use larger touch targets; long instructions and preferences scroll with a finger.

On mobile, the left pad combines acceleration, braking/reverse and steering under one thumb. The right flight pad fires all four jets from its center, pairs from its edges, and individual jets from its corners; slide between targets without lifting your finger. A separate Boost button fires the rear rockets. Both pads can be held simultaneously.

Menus, the flight manual and in-game hints use touch instructions with no keyboard labels. The primary pointer selects the initial interface; actual touch or keyboard input can switch it, including on hybrid devices. A keyboard press while fingers are held waits to switch layouts until those touches end.

Haptics use the Vibration API where supported; browsers without it remain fully playable. Audio starts after a user gesture. Master sound, music, pilot reactions, haptics, camera shake, graphics quality, and personal records persist locally.

## Flight tests

1. **The garage:** clear a home garage filled with 57 physical storage props. Racks, tools, cartons, a charger, and a bicycle frame the scene. Reach the driveway marker.
2. **The quarter mile:** cover 402 metres of drag strip. Rear rockets dramatically shorten the run; vertical jets make it interesting.
3. **The inversion:** autodrive approaches a 24-metre vertical return ramp. Ride the arc inverted, use short front and rear pulses to rotate, then cushion the landing. Completion requires actual upper-ramp contact and a stable, survivable touchdown.

For the ramp, a useful starting technique is a roughly 0.8-second Q+W burst when leaving the lip, a half-second O+P correction, then short bursts of all four as you descend through the last eight metres to soften the landing. It is intentionally possible to spin, wreck, or fly out of the test area.

Impacts crumple the body near the contact point, crack the glass, and tear loose bodywork. Collision damage depends on the closing speed and the mass of the obstacle: cartons yield, concrete does not. Detached wheels lose their suspension and grip. A critically damaged car smokes and burns. Totaling it cuts the motors and thrusters and triggers an explosion with detached panels and wheels, physical debris, a shockwave that throws nearby clutter, sparks, fire, smoke, a deep blast, and camera shake. The wreck keeps tumbling before the result screen appears. **R** restores the car and all props and clears the debris and fire.

## Implementation

- Three.js WebGL 2 renderer with physically based car materials, environment reflections and shadows. Mobile renders directly with native antialiasing; desktop High adds bloom, ambient occlusion and FXAA using capability-checked, single-sample HDR targets.
- Reference-built angular car mesh with cut-out wheel arches, glass canopy, detailed wheels/brakes, light bars, wing, diffuser, four lower nozzles and four rear nozzles.
- cannon-es rigid body dynamics at a fixed 120 Hz: 1,540 kg compound chassis, four spring/damper suspension contacts, tire grip, independent offset jet forces, impact damage, and loose props. Lift jets supply 9 kN per corner and rear thrust supplies 25 kN. Game-tuned pitch inertia, passive rotational drag, and firmer suspension damping give the chassis time to lift without a violent tail strike while retaining player-controlled flips.
- Pooled vapor/spark particles and eight instanced jet plumes. Twenty-five generated ElevenLabs audio assets ship locally: twelve effects, seven stressed/yelling pilot reactions, three frantic mission-control lines, and three original instrumental tracks.
- Web Audio mixing follows thrust, speed and collisions; voices react to flight state with cooldowns and no overlapping speech. Music crossfades between scenes and ducks under dialogue and major impacts. Synthesized effects cover loading or unavailable files. Pause and hidden tabs suspend sound; resets cancel old reactions and crash audio.
- Localized mesh deformation, detachable bodywork, a bounded physical debris system, pooled fire/smoke, blast lighting and sampled explosion/fire audio.
- Static scenery batching and three graphics settings. No CDN, server API, account or external runtime dependency is required.

The vehicle is a hand-built interpretation of the provided images, not a manufacturer CAD asset. Physics values are tuned for the game rather than presented as vehicle specifications.

## Graphics and device compatibility

WebGL 2 requires both browser and GPU support; it is not available on every phone, and support alone does not guarantee sufficient graphics memory or driver stability. Startup retries once with a fresh canvas and conservative attributes. If graphics remain unavailable, an actionable screen offers a safe reload and a diagnostic report without misidentifying every creation failure as missing WebGL 2 support. We do not claim device-specific stability without testing that device.

Mobile and embedded players retain the complete car geometry, physically based materials, reflections and destruction, while bypassing the HDR compositor, bloom and screen-space ambient occlusion. Render budgets are 0.8 megapixels on High, 0.6 on Balanced and 0.45 on Performance; screen density cannot exceed those budgets. High and Balanced use 1024-pixel shadows, while Performance disables shadows. The DOM interface stays sharp at native resolution. Mobile rendering is limited to 60 fps during play and 30 fps in menus or while paused; hidden pages stop rendering.

Sustained slow gameplay lowers render resolution after two slow measurement windows, with a cooldown between changes. Startup stalls and background pauses are excluded. Desktop High retains its richer effects with a 2.3-megapixel budget, reduced-resolution ambient occlusion and FXAA instead of multisampled HDR buffers. Unused render targets and passes are disposed when switching quality; repeated resize events do not repeatedly allocate buffers.

A lost WebGL context clears held controls and pauses physics and audio. Restoration regenerates the GPU reflection map and resumes rendering in persistent **Compatibility mode**, with a 0.45-megapixel ceiling and 512-pixel shadows. Play resumes only after the player presses Resume. Repeated or unrecoverable interruptions offer **Reload safely** instead of an automatic reload loop. A safe-mode reload also disables native antialiasing. A browser process killed by the OS cannot deliver a recoverable context-loss event. A best-effort tab-session marker enables Compatibility mode after an interrupted visible session; clean page exits and backgrounding clear the marker. Detection depends on the browser preserving session storage, so it cannot identify every tab crash.

When Chrome reports “Web page caused context loss and was blocked,” its browser-level WebGL block rejects context creation before rendering begins. The startup screen recognizes this response, saves Compatibility mode, and directs the player to Chrome’s own Reload control or to submit the address again. A JavaScript reload button cannot perform that browser-initiated unblock. This response alone does not identify the original GPU failure or prove that the latest rendering configuration has crashed.

Settings include Compatibility mode and **Copy graphics report**, which copies the browser/GPU identity, active rendering budget and resource counts locally for troubleshooting. No diagnostics are transmitted automatically. The requested quality remains saved separately from the compatibility override.

The graphics suite uses the real `WEBGL_lose_context` extension, high-DPR mobile emulation, repeated level/explosion cycles, resize bursts, quality changes and explicit recovery. Emulation uses the test computer's GPU; it does not reproduce a physical Pixel's GPU or driver.

## Validation

```sh
npm test
npm run test:browser
npm run test:audio
npm run test:player
npm run test:responsive
npm run test:flight
npm run test:touch
npm run test:graphics
npm run build
npm run preview
```

The Node suite covers suspension equilibrium, symmetric lift, asymmetric torque, frame-rate invariance, prop momentum transfer, complete ramp landings, lethal-landing rejection, ramp bypass prevention, quarter-mile completion, reset, flyaways and long mixed-input stability. Destruction checks cover mass-weighted collisions, local deformation, fracture stages, detached part transforms and resource isolation, missing-wheel handling, explosion impulses, fresh-debris collision grace and exact repeated model restoration.

Browser tests cover menus, first-run instructions, actual keyboard input, pause/reset, touch controls, collision-triggered destruction and settings. They verify moderate dents, fatal impacts, physical part detachment, one-shot blasts, paused effects and two complete wreck/reset cycles. On macOS they can use installed Chrome; otherwise install Playwright Chromium with `npx playwright install chromium`. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to use another Chromium binary. The separate production offline check runs against a built preview: `PWA_TEST_URL=http://localhost:4173 npm run test:pwa`.

Flight checks cover sustained roof-contact recovery across all levels, cancellation on movement or righting, pause/resume, key-repeat release latching, and airborne inversions that must remain controllable. Numerical checks also cover rear acceleration, rear-to-front booster transitions, takeoff clearance, angular momentum, and complete ramp landings.

Touch-control checks cover simultaneous analog driving and lift, sliding between paired and individual jets, duplicate holds, release/cancel/reset/rotation, and keyboard/touch switching. Responsive checks cover small phones, landscape phones, tablets, and desktop layouts, including level selection, minimum touch targets, real finger scrolling, saved preferences, result actions, first-run instructions, and mid-flight rotation. Layouts and all three level launches have also been exercised in WebKit with mobile emulation; notch and home-indicator insets were checked through Chrome’s safe-area emulation.

Audio tests additionally decode every MP3, exercise delayed/failed downloads, saved music/voice preferences, master mute, scene music and stale-voice cancellation. `PWA_TEST_URL=http://localhost:4173 npm run test:audio` verifies the entire audio pack can be decoded offline.

## Audio production

The source prompts are in `scripts/audio-prompts.json`; generated asset provenance is recorded in `reference/audio-generation.json`. Pilot lines use the expressive Harry stock voice with panic, shouting and screaming directions. Alice delivers stressed, shouted mission-control interludes. Instrumental menu, driving and inversion tracks use Eleven Music. Files are trimmed and loudness-matched with FFmpeg, then saved as MP3s under `public/audio/`.

Generation is an explicit development step and is never run by the game or Netlify. The browser only fetches static audio; no ElevenLabs account or API key is needed to play or deploy. To regenerate with your own ElevenLabs account, set `ELEVENLABS_API_KEY` in your local environment and run `python3 scripts/generate-audio.py`. This requires Python 3, FFmpeg and FFprobe. Existing assets are kept by default; `--only voices`, `--only music-drive`, `--replace` and `--plan` allow deliberate targeted work. `--replace` makes new paid generation requests. `--master-only` reprocesses retained raw files without API calls. Raw audio and local QA reports remain in ignored `reference/qa/`.

API references: [sound effects](https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert), [expressive speech](https://elevenlabs.io/docs/api-reference/text-to-speech/convert), and [music composition](https://elevenlabs.io/docs/api-reference/music/compose).

The title uses `public/art/roadster-wordmark.svg`, traced from the supplied `logo.webp` with cleaned geometric contours and matching repeated letters. The companion car silhouette is retained as `public/art/roadster-silhouette.svg`. Both are transparent, scalable vectors; title layout preserves the original wide proportions.

Reference analysis and visual QA captures are retained in `reference/`. See `reference/visual-study.md` for the video observations and `reference/og-image-prompt.md` / `reference/level-art-prompt.md` for the generated artwork briefs.

## Netlify

The connected GitHub repository can deploy this directly. `netlify.toml` specifies:

- Build: `npm run build`
- Publish directory: `dist`
- Node: `22`
- Immutable caching for hashed assets; revalidation for HTML and the install manifest; no caching for the service worker.

The production canonical URL, Open Graph and Twitter image URLs, JSON-LD, sitemap and robots file are set to **https://roadster.superfun.games/**. The social image is `public/og-image.png` at exactly 1200 × 630. If the domain changes, update `index.html`, `player/index.html`, the full-game link in `src/ui.js`, `public/sitemap.xml` and `public/robots.txt` together.

No environment variables are needed. Build artifacts are ignored; push the source and lockfile to the Netlify-connected deployment branch when ready to publish.

## X Player Card

Share **https://roadster.superfun.games/**. Its server-rendered tags request a 640 × 480 Player Card at **https://roadster.superfun.games/player/**, with the existing social artwork as its poster. The player is a separate Vite HTML entry using the same game code and all three levels. The full site keeps its Open Graph image, install support and normal layout.

The compact player keeps keyboard and simultaneous touch controls visible in a small frame, starts sound only after a gesture, pauses and releases held controls on lost focus, and tolerates blocked storage. It skips install prompts and service-worker registration. An “Open full game” link opens a new tab. On a top-level portrait touch player, the bottom 30% is reserved for the mobile overlay described in the supplied reference; an actual iframe uses its entire allocated height. This reserve is a compatibility heuristic, not a detected X API value.

Netlify replaces `X-Frame-Options` with a `frame-ancestors` policy allowing this site and HTTPS X/Twitter domains, including their card-frame subdomains. Public built scripts/styles, audio and artwork have anonymous CORS headers so they also load inside a sandbox with an opaque origin. No account, form submission or parent-window messaging is required.

`npm run test:player` exercises real cross-origin sandbox frames, including denied storage, audio unlock, keyboard lift, host focus, simultaneous touch, 640 × 480 / 320 × 240 cards, and a simulated mobile overlay. Run `PWA_TEST_URL=http://localhost:4173 npm run test:player` after a build for production browser coverage. `npx playwright test tests/frame-policy.spec.js` checks the configured HTTP headers in the browser: nested X/Twitter frames can load modules and sound, while unrelated ancestors are blocked.

The [official Player Card sample](https://github.com/xdevplatform/cards-player-samples/blob/main/player/page.html) documents the tag format. These local tests do not establish that X will display an interactive card for this domain. After Netlify publishes, confirm that the exact HTTPS share and player URLs return 200 without redirects and verify the card in X on desktop and mobile. Use the configured domain as-is; adding `www` is not required. No post is created automatically.

## Install and offline play

The install button supports the native install prompt and gives platform-specific instructions when needed. The manifest includes standalone display, maskable icons, Apple touch artwork and shortcuts for the three tests.

Each production build generates a content-versioned service worker with the exact emitted asset names. After one successful online load, the complete game is available offline. A new deployment creates a fresh cache. The service worker is disabled and old game caches are removed during development to avoid stale code.

Real-device Safari installation, physical haptic feel and the public Netlify deployment still need verification on the target devices/domain. Chrome and WebKit rendering, mobile viewport/touch events, production caching and offline play have been exercised locally.
