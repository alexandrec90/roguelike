import "./style.css";
import { isSkinKey } from "./game/keybindings";
import { nextSkin, parseSkin, skinHref, type SkinId, type SkinModule } from "./skins/skin";

// Which look to draw the world in (`src/skins/skin.ts`): `?skin=pixel` or
// `?skin=lowpoly`. The simulation underneath is the same either way.
const query = new URLSearchParams(window.location.search);
const skin = parseSkin(query.get("skin"));

/**
 * Each skin is its own chunk, imported only when chosen, so a load downloads
 * and compiles one renderer rather than all of them.
 */
const SKIN_MODULES: Readonly<Record<SkinId, () => Promise<SkinModule>>> = {
  pixel: () => import("./skins/pixel"),
  lowpoly: () => import("./skins/lowpoly"),
};

const host = gameHost();

function gameHost(): HTMLElement {
  const element = document.getElementById("game");
  if (element === null) {
    throw new Error("The page has no #game element to draw into");
  }
  return element;
}

// The switch key reloads the page under the next skin, every other knob kept.
window.addEventListener("keydown", (event) => {
  if (isSkinKey(event.code)) {
    event.preventDefault();
    window.location.assign(skinHref(window.location.href, nextSkin(skin)));
  }
});

void SKIN_MODULES[skin]().then((module) => module.mount(host, query));
