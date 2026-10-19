// app/components/AMark.jsx — |A| (owner ruling 18 Oct 2026, CONSTITUTION
// A6 (4)): "simply a box with the letter A in it". One component draws it
// everywhere the mark appears — the Exploration Active indicator in the Info
// Dock, the Search toggle, |A| Protection, the ASTERISK control. It is never
// the friend asterisk, which is a plain typographic * before a name.
export default function AMark({ className = "", label = "ASTERISK", size = null, ...rest }) {
  return (
    <span className={("amark " + className).trim()} role="img" aria-label={label} style={size ? { fontSize: size } : undefined} {...rest}>A</span>
  );
}
