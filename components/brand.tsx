import { Glyph } from "./icons";

export function Brand() {
  return <span className="brand">
    <span className="brand-mark"><Glyph name="bell" size={20} /></span>
    <span>barker<span className="brand-period">.</span></span>
  </span>;
}
