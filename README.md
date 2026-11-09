# Parking Coach UK

A 3D browser parking simulator for learning the four **DVSA driving test manoeuvres** in a **right-hand-drive manual** car: what to look for, roughly when to start turning and in which direction, and when to stop.

## Play

No install or build step needed. Either:

- open `index.html` in Chrome, Edge or Firefox (double-click it), or
- serve the folder with any static server and open it.

Three.js loads from a CDN, so you need an internet connection.

## What's in it

| Manoeuvre | What you practise |
|---|---|
| Reverse bay park | Positioning, the stop point, full right lock, straightening when the lines look parallel |
| Forward bay park | Swinging wide, the turn-in point, then reversing back out |
| Parallel park | Pulling alongside the lead car, the 45° method, kerb distance |
| Pull up on the right & reverse | Signalling, crossing, stopping close to the kerb, reversing about two car lengths |
| Free practice | Park in any empty bay |

Each manoeuvre has three modes:

- **Demo**: the car drives itself and the camera turns to where you should be looking at each moment.
- **Guided**: you drive. Step-by-step prompts, a "stop here / turn now" meter, a ghost car at the ideal position, yellow highlights on the line or bumper to watch, and live gaps to the lines.
- **Test**: no prompts. You're scored like on the test (minor and serious faults), then a debrief compares when you turned and straightened with the ideal moment.

### Reference points are computed, not hard-coded

The reference points ("stop when the second line after your bay lines up with your right door mirror", "full left lock when the lead car's rear bumper is just behind your left rear wheel") are worked out from the selected car's real dimensions: wheelbase, overhangs, turning circle, mirror and seat position. They change if you switch between the **VW T-Cross** and the **VW Tiguan**.

For kerb distance there's a yellow **sticker on the bonnet** where the kerb appears at 30 cm, and a yellow **guide line in the door mirror**. These are the same tricks instructors teach.

### Manual gearbox

The clutch is on the **mouse wheel** (scroll down = press). There's a biting point, the creep speed depends on clutch position, and the engine stalls if you dump the clutch or brake without it. You have to select gears with the clutch down.

### Observation is scored

In the driver's seat, look around with the mouse. The game tracks the blind spots, rear window and mirrors. It records a fault if you move off or reverse without all-round checks, or reverse without looking behind.

## Controls

| Key | Action |
|---|---|
| Mouse wheel | Clutch pedal (down = press) |
| Q / E / B | Clutch fully down / fully up / to just below the biting point |
| W / S | Gas / brake |
| A / D | Steer (the wheel stays where you leave it at parking speeds) |
| 1 2 R N | Gears |
| Space | Handbrake |
| I | Restart the engine |
| , . | Indicators |
| Click + mouse | Look around |
| C | Driver's seat / top-down / chase view |
| M | Dip the left mirror |
| G / P | Guide lines / parking sensors |
| Backspace / Enter / Tab | Restart / finish attempt / menu |

## Code layout

```
index.html        page + HUD markup
css/style.css     HUD and menu styling
js/config.js      car specs (T-Cross, Tiguan) and maths helpers
js/vehicle.js     bicycle-model steering + manual drivetrain (clutch, stall)
js/carModel.js    low-poly car with interior, working mirrors
js/world.js       car parks, roads, parked cars, collisions
js/levels.js      the manoeuvres: coaching steps, reference points, scoring
js/coach.js       observation tracking, guided/demo step runner, faults
js/audio.js       engine, parking sensors, bumps
js/main.js        renderer, cameras, input, HUD, debrief
```

Reference points shift a little with seat position, so check them in the real car with an instructor.
