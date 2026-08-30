import tomllib
from pathlib import Path


def test_python_package_discovery_excludes_frontend_build_output():
    config = tomllib.loads(Path("pyproject.toml").read_text(encoding="utf-8"))

    assert config["tool"]["setuptools"]["packages"]["find"]["include"] == ["roguelike*"]
