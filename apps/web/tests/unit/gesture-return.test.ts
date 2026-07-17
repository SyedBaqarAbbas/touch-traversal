import { describe, expect, it } from "vitest";

import rawFixtures from "../fixtures/gesture-fixtures.json";
import {
  expandGestureFixtures,
  findGestureFixture,
  type GestureFixtureFile,
  type TimestampedLandmarkFrame,
} from "../../lib/gesture-classifier";
import {
  classifyOpenPalmFrame,
  createOpenPalmReturnState,
  runOpenPalmReturn,
  updateOpenPalmReturn,
} from "../../lib/gesture-return";

const fixtures = expandGestureFixtures(
  rawFixtures as unknown as GestureFixtureFile,
);

describe("open palm return gesture", () => {
  it("requires four extended fingers plus a separated thumb", () => {
    expect(
      classifyOpenPalmFrame(
        findGestureFixture(fixtures, "open-palm").frames[0]!,
      ).open,
    ).toBe(true);
    expect(
      classifyOpenPalmFrame(findGestureFixture(fixtures, "pointing").frames[0]!)
        .open,
    ).toBe(false);
    expect(
      classifyOpenPalmFrame(findGestureFixture(fixtures, "idle").frames[0]!)
        .open,
    ).toBe(false);
  });

  it("returns only after the configured hold completes", () => {
    const frames = retime(
      findGestureFixture(fixtures, "open-palm").frames[0]!,
      [0, 220, 480, 620],
    );
    const events = runOpenPalmReturn(frames, { safeToReturn: true });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      progress: 1,
      timestampMs: 480,
      type: "return",
    });
  });

  it("reports ring progress during hold and cancels when the pose breaks", () => {
    const openPalm = findGestureFixture(fixtures, "open-palm").frames[0]!;
    const pointing = findGestureFixture(fixtures, "pointing").frames[0]!;
    let state = createOpenPalmReturnState();

    let update = updateOpenPalmReturn(state, withTime(openPalm, 0), {
      safeToReturn: true,
    });
    state = update.state;
    expect(state.progress).toBe(0);

    update = updateOpenPalmReturn(state, withTime(openPalm, 240), {
      safeToReturn: true,
    });
    state = update.state;
    expect(state.progress).toBeCloseTo(0.5);
    expect(update.event).toBeNull();

    update = updateOpenPalmReturn(state, withTime(pointing, 300), {
      safeToReturn: true,
    });
    expect(update.state.progress).toBe(0);
    expect(update.state.holdStartedAtMs).toBeNull();
  });

  it("ignores valid open palm poses during unsafe transitions", () => {
    const frames = retime(
      findGestureFixture(fixtures, "open-palm").frames[0]!,
      [0, 240, 520],
    );

    expect(runOpenPalmReturn(frames, { safeToReturn: false })).toHaveLength(0);
  });

  it("does not trigger from accidental pointing or idle fixtures", () => {
    const accidentalFrames = [
      ...retime(
        findGestureFixture(fixtures, "pointing").frames[0]!,
        [0, 240, 520],
      ),
      ...retime(findGestureFixture(fixtures, "idle").frames[0]!, [760, 1000]),
    ];

    expect(
      runOpenPalmReturn(accidentalFrames, { safeToReturn: true }),
    ).toHaveLength(0);
  });
});

function retime(
  frame: TimestampedLandmarkFrame,
  timestampsMs: readonly number[],
): TimestampedLandmarkFrame[] {
  return timestampsMs.map((timestampMs) => withTime(frame, timestampMs));
}

function withTime(
  frame: TimestampedLandmarkFrame,
  timestampMs: number,
): TimestampedLandmarkFrame {
  return {
    ...frame,
    timestampMs,
  };
}
