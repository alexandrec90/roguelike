# Camera motion and the strafe radius

**Strafe quantisation is not confined to the tiles.** A strafe rotates the local
frame, and the renderer carries a step in flight as a
*single uniform translation* (`scrollPhase`), so **everything drawn from the local frame
pays it**: trees, props, puddles, the slime, the torch. Those are point features, not
cells; they have exact planet coordinates and could follow the true arc continuously. As
built they cannot, because they are drawn from `groundPose + scrollPhase` so the whole
picture moves rigidly, and a translation cannot approximate a rotation. The two agree at
the start of a step and part company by its end, where every object on screen snaps by a
*different* amount — sideways by `d · y / radius`, and in **depth** by `d · x / radius`,
so things left and right of the hero jump in opposite directions. At radius 19 that was
7.5px of up-and-down and 10px of sideways per step, and it read as objects moving
unpredictably rather than as a world turning. Walking forward is exempt, because that
step genuinely is a translation.

`DEFAULT_STRAFE_RADIUS` is 512 for exactly this reason, not for feel: depth motion goes
sub-pixel at 277 and both axes do at 474, so at 512 nothing on screen can move a whole
pixel because of a strafe, and the arc is shallow enough that the straight-line slide the
renderer draws is within half a pixel of the arc the simulation walks. `map-drift.ts`
holds that arithmetic and `map-drift.test.ts` pins it, so lowering the radius fails a
test rather than quietly returning the jumping. **If you want a tight radius back — a
world that visibly turns under a strafe — raising the number is not enough; the sub-step
motion has to be drawn as the arc it is, per object, rather than as one offset for the
whole scene.** `?map=1` draws that disagreement as a field of lines and is the fastest
way to see whether a change helped.
