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
        "Keep turn simulation deterministic",
        "Maintain an asset-lab scene",
        "Give each agent branch its own Git worktree",
    )
    missing = [constraint for constraint in required_constraints if constraint not in instructions]

    assert missing == [], f"CLAUDE.md lost visual architecture constraints: {missing}"
