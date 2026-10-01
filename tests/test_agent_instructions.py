from pathlib import Path


def test_visual_architecture_is_a_durable_agent_contract():
    instructions = " ".join(Path("CLAUDE.md").read_text(encoding="utf-8").split())

    required_constraints = (
        "Render the world at 320",
        "nearest-neighbor upscale",
        "covers the full window",
        "Centre-crop horizontal overflow",
        "keep the horizon pinned to the top",
        "never expose a border or distort the aspect ratio",
        "palette-indexed raster sprites",
        "SVG is not a primary game-art format",
        "Use math for motion, light, particles",
        "grid-quantized translation",
        "simulation deterministic and independent of the presentation layer",
        "Maintain an asset-lab scene",
        "Give each agent branch its own Git worktree",
    )
    missing = [constraint for constraint in required_constraints if constraint not in instructions]

    assert missing == [], f"CLAUDE.md lost visual architecture constraints: {missing}"


def test_the_module_maps_load_with_the_game_code_they_map():
    """The camera, ink and scenery maps grew CLAUDE.md to the 500-line contract (two PRs
    at 499 merged into 500 on main), so they live in a rule scoped to the game's modules;
    CLAUDE.md keeps only the pointer that sends an agent there."""
    rule = Path(".claude/rules/game-architecture.md").read_text(encoding="utf-8")
    head, _, body = rule.partition("\n---\n")
    claude_md = Path("CLAUDE.md").read_text(encoding="utf-8")

    assert "src/game/**/*.ts" in head
    for owner in ("src/game/projection.ts", "src/game/ink.ts", "src/game/scenery.ts"):
        assert f"| `{owner}` |" in body, f"{owner} lost its row in the module map"
        assert f"| `{owner}` |" not in claude_md, f"{owner}'s row is back in CLAUDE.md"
    assert ".claude/rules/game-architecture.md" in claude_md
