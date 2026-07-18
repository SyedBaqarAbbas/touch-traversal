type GestureGlyphName =
  | "grab"
  | "open-palm"
  | "orbit"
  | "pan"
  | "pinch"
  | "point"
  | "release"
  | "swipe"
  | "zoom";

export type HandGestureGuideItem = {
  gesture: string;
  glyph: GestureGlyphName;
  movement: string;
  result: string;
};

export type HandGestureGuideContent = {
  intro: string;
  items: readonly HandGestureGuideItem[];
  note: string;
  title: string;
};

export function HandGestureGuide({
  content,
}: {
  content: HandGestureGuideContent;
}) {
  return (
    <section
      aria-labelledby="hand-gesture-guide-title"
      className="hand-gesture-guide"
    >
      <header>
        <p className="eyebrow">movement guide</p>
        <h2 id="hand-gesture-guide-title">{content.title}</h2>
        <p>{content.intro}</p>
      </header>
      <ol>
        {content.items.map((item, index) => (
          <li key={item.gesture}>
            <GestureGlyph name={item.glyph} />
            <div>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <h3>{item.gesture}</h3>
              <p>{item.movement}</p>
              <small>{item.result}</small>
            </div>
          </li>
        ))}
      </ol>
      <p className="hand-gesture-guide__note">{content.note}</p>
    </section>
  );
}

function GestureGlyph({ name }: { name: GestureGlyphName }) {
  return (
    <svg
      aria-hidden="true"
      className="hand-gesture-glyph"
      data-gesture={name}
      viewBox="0 0 80 80"
    >
      <g className="hand-gesture-glyph__hand">
        <path d="M30 62c-4-7-6-15-5-23l1-17c.2-3 4-3 4 0v17-25c0-3 4-3 4 0v23-27c0-3 4-3 4 0v27-24c0-3 4-3 4 0v25-17c0-3 4-3 4 0v26l7-7c3-3 7 1 5 5L48 62Z" />
        <circle className="hand-gesture-glyph__tip" cx="36" cy="10" r="2.4" />
        <circle className="hand-gesture-glyph__thumb" cx="58" cy="40" r="2.4" />
      </g>
      {name === "point" ? (
        <g className="hand-gesture-glyph__cue">
          <path d="M36 4v7" />
          <circle cx="36" cy="3" r="1.6" />
        </g>
      ) : null}
      {name === "pinch" || name === "grab" || name === "release" ? (
        <g className="hand-gesture-glyph__cue">
          <path d="M39 17 54 34" />
          <circle cx="46.5" cy="25.5" r={name === "release" ? "7" : "3"} />
          {name === "grab" ? (
            <path d="M17 23v-7h7m32 0h7v7M17 56v7h7m32 0h7v-7" />
          ) : null}
        </g>
      ) : null}
      {name === "open-palm" ? (
        <g className="hand-gesture-glyph__cue">
          <circle cx="40" cy="39" r="28" />
          <path d="M17 17 12 12m51 5 5-5M40 7V1" />
        </g>
      ) : null}
      {name === "swipe" || name === "orbit" ? (
        <g className="hand-gesture-glyph__cue">
          <path d="M11 68h58m-52-6-6 6 6 6m46-12 6 6-6 6" />
        </g>
      ) : null}
      {name === "pan" ? (
        <g className="hand-gesture-glyph__cue">
          <path d="M67 12v56m-6-50 6-6 6 6m-12 44 6 6 6-6" />
        </g>
      ) : null}
      {name === "zoom" ? (
        <g className="hand-gesture-glyph__cue">
          <circle cx="40" cy="40" r="25" />
          <circle cx="40" cy="40" r="31" />
          <path d="m62 18 8-8m-8 0h8v8" />
        </g>
      ) : null}
    </svg>
  );
}
