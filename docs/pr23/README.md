# PR #23 visual verification

Captured from the PR repair worktree served on port 4108.

- [Logical 1× capture](chestnut-1x.png): http://127.0.0.1:4108/lab.html?asset=tree-sdf-crown&variant=authored&frame=0&t=0&play=0&zoom=1&bg=duo
- [Enlarged 6× capture](chestnut-6x.png): http://127.0.0.1:4108/lab.html?asset=tree-sdf-crown&variant=authored&frame=0&t=0&play=0&zoom=6&bg=duo
- Tree comparison: http://127.0.0.1:4108/trees.html?play=0&renderer=diff&zoom=1&shadow=0
- World and movement instrument: http://127.0.0.1:4108/?map=1

The chestnut silhouette and trunk remain readable on both grounds. Authored,
autumn, blighted, and moonlit variants were inspected, along with frame 6 of the
gust cycle. The tree lab reports four GPU bodies and zero differing pixels.
An additional browser readback of the chestnut's trunk and canopy at scales 1,
0.5, and 0.18, at near and far detail, reports zero differing pixels in all twelve
comparisons (seed 32305, time 0, light −0.6/−0.8).

Regression tests cover nearby trees displacing distant slot holders, centre-line
normal stability, scaled lighting bounds, and clips between screen pixels.
