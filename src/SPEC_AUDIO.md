# Audio module spec - `src/audio.js` (global `MCAudio`)

You are writing the sound engine for a single-file browser Minecraft clone. Everything (all SFX and the music) must be **synthesised in code** - no external files, no base64 blobs.
Target: sound like vanilla Minecraft Java Edition (chunky, slightly lo-fi, short) and a C418-style ambient music feel.

Constraints (same as the other asset modules):
* Plain ES2020, one IIFE, one global: `(function (G) { ... })(typeof window !== 'undefined' ? window : globalThis);` -> `G.MCAudio`.
* Must not throw if `AudioContext` is missing or blocked; every public function must be a safe no-op until `init()` succeeded.
* `init()` is called from a user gesture (first click). It creates the `AudioContext` (resume it if suspended) and pre-renders all SFX into `AudioBuffer`s using plain JS DSP (fill `Float32Array`s directly, e.g. filtered noise bursts, sine/triangle/saw/square oscillators with pitch sweeps, ADSR envelopes, simple biquad/one-pole filters, resonators/modal synthesis, bit-crush for a lo-fi vanilla feel) - or `OfflineAudioContext`.
  Total pre-render time should be under ~1.2 s on a normal laptop (you may yield between groups with `await` / `setTimeout` so the page does not freeze; `init()` returns a Promise that resolves when SFX are ready. Music may be generated lazily).
* Each named sound should have 2-4 **variants** (like vanilla's dig/step1..4) chosen randomly on each `play`, plus a small random pitch jitter (+-6%).
* Playback: `AudioBufferSourceNode` -> `GainNode` -> (`StereoPannerNode` if available) -> master `GainNode` -> `DynamicsCompressor` (gentle, to avoid clipping when many sounds overlap) -> destination. Limit polyphony (max ~24 simultaneous voices; drop the oldest/quietest).
* Volumes: separate multipliers `master`, `sfx`, `music`.

## Public API (exactly this)
```js
MCAudio.init()                      // -> Promise<boolean>   (idempotent)
MCAudio.ready                       // boolean
MCAudio.play(name, opts)            // opts: { vol=1, pitch=1, pan=0 }     -> plays one variant of the named sound, returns nothing
MCAudio.playAt(name, x, y, z, opts) // 3D-ish: attenuates with distance to the listener (linear falloff to silence at ~16 blocks; louder sounds like explosions carry to ~48 via opts.range), pans by angle relative to listener yaw
MCAudio.setListener(x, y, z, yaw)   // yaw in radians (0 = looking towards -Z, increasing = turning left/counter-clockwise like Minecraft: forward vector = (-sin(yaw), 0, -cos(yaw)))
MCAudio.setVolume(kind, v)          // kind: 'master' | 'sfx' | 'music', v in 0..1
MCAudio.getVolume(kind)
MCAudio.names                        // array of all sound names
MCAudio.music = {
  play(),                            // start a new generative piece (fades in ~4 s). No-op if already playing.
  stop(fadeSeconds = 3),
  isPlaying(),                       // boolean
  setMood(name)                      // 'calm' (default overworld) | 'cave' (darker, sparser) - crossfades the key/timbre for subsequent notes
}
MCAudio.startLoop(name, opts) -> id  // looping ambience (rain, furnace crackle); opts {vol}
MCAudio.stopLoop(id)
MCAudio.setLoopVolume(id, v)
```

## Sound names to implement (all of them, exact spelling; variants inside)
Blocks (dig = break AND place sound, pitch-shifted by caller; step = footstep, quieter/shorter; hit = the tick while mining, use `dig.*` at low volume so no separate hit needed):
`dig.stone dig.grass dig.gravel dig.sand dig.wood dig.glass dig.cloth dig.snow dig.plant dig.metal`
`step.stone step.grass step.gravel step.sand step.wood step.cloth step.snow step.plant`
 - grass: soft rustle (band-passed noise, ~90 ms); gravel: crunchy granular; sand: dry soft shh-crunch; wood: hollow knock (short resonant thunk); stone: hard click/thud with a bright transient; glass: shatter for dig (bright tinkle burst with resonances) ; cloth: muffled soft thump; snow: soft crunchy squeak; plant: quick leafy swish; metal: ringing clank.
Player / world:
`damage.hurt` (the classic "oof": short falling-pitch square/saw + noise burst), `damage.fall_small`, `damage.fall_big` (thud + crunch), `damage.death`,
`random.eat` (crunchy chomp series), `random.burp`, `random.drink`, `random.pop` (item pickup - short rising bubble pop), `random.click` (UI click: tiny sharp tick), `random.levelup` (rising arpeggio chime),
`random.orb` (xp pickup - bright short blip, pitch varies), `random.break` (tool breaking: crack + tinkle), `random.bow` (twang), `random.bowhit` (arrow thunk), `random.door_open`, `random.door_close` (creaky wood + latch), `random.chestopen` (creak + thunk), `random.chestclosed`,
`random.explode` (big low boom with noise tail, ~1.2 s), `random.fuse` (TNT/creeper hiss, ~1.5 s), `random.fizz` (short quench hiss), `random.anvil_land` is NOT needed.
`liquid.splash` (water entry splash, noisy), `liquid.swim` (small paddle splash), `liquid.water` (occasional soft ambient bubble/drip), `liquid.lava` (soft crackle pop), `liquid.lavapop`, `fire.ignite` (flint & steel: click + whoosh), `fire.fire` (short crackle, for loop use).
Mobs: `mob.pig.say` (2 variants of grunty oink), `mob.pig.death`, `mob.cow.say` (low moo), `mob.cow.hurt`, `mob.sheep.say` (baa, bleat), `mob.chicken.say` (cluck), `mob.chicken.hurt`, `mob.chicken.plop` (egg drop),
`mob.zombie.say` (groan - low, raspy, wobbling), `mob.zombie.hurt`, `mob.zombie.death`, `mob.skeleton.say` (bone rattle), `mob.skeleton.hurt`, `mob.skeleton.death`, `mob.creeper.say` (short hiss-hurt), `mob.creeper.death`, `mob.spider.say` (scratchy hiss), `mob.spider.death`, `mob.generic.hurt` (fallback), `mob.generic.death`, `mob.generic.swing` (attack swoosh - `random.` style whoosh).
Ambient one-shots: `ambient.cave` (6+ variants: distant eerie drones, rumbles, metallic echoes - low volume, long 2-5 s tails), `ambient.thunder` (rumble ~3 s).
Loops (via `startLoop`): `loop.rain` (soft continuous rain: filtered noise with tiny amplitude modulation, seamless), `loop.fire` (crackling), `loop.wind` (soft), `loop.lava` (bubbling).

## Music (`MCAudio.music`)
Generative, endless-ish ambient piano-ish piece à la C418 ("Minecraft" / "Sweden" / "Wet Hands" feel):
* Warm soft *felt-piano/sine+triangle mallet* voice (fast attack, exponential decay 2-4 s, gentle low-pass, tiny detune chorus), a very slow pad underneath (optional), plenty of **reverb** (generate a synthetic impulse response - decaying stereo noise ~3.5 s - and use `ConvolverNode`) and long silences between phrases.
* Slow tempo (~ 60-72 bpm feel), sparse melodic fragments over a slowly changing chord progression in a diatonic/pentatonic mode (e.g. C major / A minor / F lydian colour, add9/sus2 voicings), occasional single bass note, rests, and slight timing/velocity humanisation.
* Each `music.play()` should pick a different seed so pieces differ; a piece lasts ~90-180 s and then fades out by itself (`isPlaying()` becomes false) so the game can schedule the next one after a random pause, like vanilla.
* Scheduling: use the Web Audio clock with a look-ahead scheduler (`setInterval` every ~200 ms scheduling notes within the next ~1 s); nodes must be cleaned up (no leaks). Music volume is separate and defaults lower than SFX (music multiplier default 0.5).
* `'cave'` mood: lower register, more sparse, minor/phrygian colour, longer reverb tail.

## Quality bar
Vanilla sounds are simple but *characterful*. Avoid harsh, piercing or clipping output: normalise every rendered buffer to a peak of ~0.7-0.9 (then vol scale), apply short fade-in/out (2-5 ms) to avoid clicks. Step sounds must be quiet and short; break sounds slightly louder than place sounds (caller handles that with pitch/vol).
Test by rendering some sounds to `.wav` files under `D:\sonnet 5.5\_ref\agent_out\` with a Node script (write a WAV writer, run the DSP part in Node) and check waveforms / spectra numerically (peak, RMS, duration, no NaNs, no DC offset, no clipping). You cannot listen, so be careful and conservative: keep pitches in a musically sensible range and envelopes smooth.
Structure the code so the DSP (buffer synthesis) is pure functions taking `sampleRate` so it can run in Node for testing while the playback layer touches `AudioContext` only inside `init()`/`play()`.

Only create/modify: `src/audio.js`, `tools/test_audio.js`, and files under `_ref/agent_out/`. Do not use the browser tools. When done reply with a SHORT summary (what exists, load time measured in Node, anything the engine author must know).
