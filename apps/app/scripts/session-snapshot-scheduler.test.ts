import { describe, expect, test } from "bun:test";

import { scheduleSessionSnapshot } from "../src/react-app/domains/session/sync/session-snapshot-scheduler";

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("session snapshot scheduler", () => {
  test("runs at most one interactive request per workspace", async () => {
    const first = deferred<string>();
    let active = 0;
    let maximum = 0;
    const run = (value: string) => async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      if (value === "first") await first.promise;
      active -= 1;
      return value;
    };

    const firstRequest = scheduleSessionSnapshot({
      workspaceId: "workspace",
      requestKey: "same",
      priority: "interactive",
      run: run("first"),
    });
    const secondRequest = scheduleSessionSnapshot({
      workspaceId: "workspace",
      requestKey: "same",
      priority: "interactive",
      run: run("second"),
    });
    await settle();
    expect(maximum).toBe(1);

    first.resolve("first");
    expect(await firstRequest).toBe("first");
    expect(await secondRequest).toBe("second");
    expect(maximum).toBe(1);
  });

  test("new interactive work aborts a different active request", async () => {
    let firstAborted = false;
    const firstRequest = scheduleSessionSnapshot({
      workspaceId: "workspace",
      requestKey: "first",
      priority: "interactive",
      run: (signal) =>
        new Promise<string>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              firstAborted = true;
              reject(new Error("aborted"));
            },
            { once: true },
          );
        }),
    });
    await settle();
    const secondRequest = scheduleSessionSnapshot({
      workspaceId: "workspace",
      requestKey: "second",
      priority: "interactive",
      run: async () => "second",
    });

    await expect(firstRequest).rejects.toMatchObject({ name: "AbortError" });
    expect(await secondRequest).toBe("second");
    expect(firstAborted).toBe(true);
  });

  test("starts replacement work even when the cancelled transport ignores abort", async () => {
    const stuck = deferred<string>();
    let secondStarted = false;
    const firstRequest = scheduleSessionSnapshot({
      workspaceId: "workspace",
      requestKey: "stuck",
      priority: "interactive",
      run: async () => stuck.promise,
    });
    await settle();
    const secondRequest = scheduleSessionSnapshot({
      workspaceId: "workspace",
      requestKey: "replacement",
      priority: "interactive",
      run: async () => {
        secondStarted = true;
        return "replacement";
      },
    });

    await expect(firstRequest).rejects.toMatchObject({ name: "AbortError" });
    expect(await secondRequest).toBe("replacement");
    expect(secondStarted).toBe(true);
    stuck.resolve("late");
  });

  test("caps real transport executions when cancelled requests ignore abort", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    let active = 0;
    let maximum = 0;
    let thirdStarted = false;
    const uncooperative = (pending: Promise<string>) => async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      const value = await pending;
      active -= 1;
      return value;
    };
    const firstRequest = scheduleSessionSnapshot({
      workspaceId: "bounded-workspace",
      requestKey: "first",
      priority: "interactive",
      run: uncooperative(first.promise),
    });
    const firstOutcome = firstRequest.catch((error: unknown) => error);
    await settle();
    const secondRequest = scheduleSessionSnapshot({
      workspaceId: "bounded-workspace",
      requestKey: "second",
      priority: "interactive",
      run: uncooperative(second.promise),
    });
    const secondOutcome = secondRequest.catch((error: unknown) => error);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(maximum).toBe(2);
    const thirdRequest = scheduleSessionSnapshot({
      workspaceId: "bounded-workspace",
      requestKey: "third",
      priority: "interactive",
      run: async () => {
        thirdStarted = true;
        return "third";
      },
    });

    expect(await firstOutcome).toMatchObject({ name: "AbortError" });
    expect(await secondOutcome).toMatchObject({ name: "AbortError" });
    await settle();
    expect(thirdStarted).toBe(false);
    first.resolve("late-first");
    expect(await thirdRequest).toBe("third");
    expect(maximum).toBe(2);
    second.resolve("late-second");
  });

  test("keeps only the two newest waiting background requests", async () => {
    const first = deferred<void>();
    const started: string[] = [];
    const firstRequest = scheduleSessionSnapshot({
      workspaceId: "workspace",
      requestKey: "one",
      priority: "background",
      run: async () => {
        started.push("one");
        await first.promise;
        return "one";
      },
    });
    const secondRequest = scheduleSessionSnapshot({
      workspaceId: "workspace",
      requestKey: "two",
      priority: "prefetch",
      run: async () => {
        started.push("two");
        return "two";
      },
    });
    const thirdRequest = scheduleSessionSnapshot({
      workspaceId: "workspace",
      requestKey: "three",
      priority: "background",
      run: async () => {
        started.push("three");
        return "three";
      },
    });
    const fourthRequest = scheduleSessionSnapshot({
      workspaceId: "workspace",
      requestKey: "four",
      priority: "prefetch",
      run: async () => {
        started.push("four");
        return "four";
      },
    });

    await expect(secondRequest).rejects.toMatchObject({ name: "AbortError" });
    first.resolve();
    expect(await firstRequest).toBe("one");
    expect(await thirdRequest).toBe("three");
    expect(await fourthRequest).toBe("four");
    expect(started).toEqual(["one", "three", "four"]);
  });

  test("caller abort cancels queued work before its run starts", async () => {
    const first = deferred<void>();
    let secondStarted = false;
    const firstRequest = scheduleSessionSnapshot({
      workspaceId: "workspace",
      requestKey: "first",
      priority: "background",
      run: async () => {
        await first.promise;
        return "first";
      },
    });
    const abort = new AbortController();
    const secondRequest = scheduleSessionSnapshot({
      workspaceId: "workspace",
      requestKey: "second",
      priority: "background",
      signal: abort.signal,
      run: async () => {
        secondStarted = true;
        return "second";
      },
    });

    abort.abort();
    await expect(secondRequest).rejects.toMatchObject({ name: "AbortError" });
    first.resolve();
    await firstRequest;
    expect(secondStarted).toBe(false);
  });

  test("a twenty-session hover burst executes only the active and two newest snapshots", async () => {
    const releaseFirst = deferred<void>();
    const started: string[] = [];
    const outcomes = Array.from({ length: 20 }, (_, index) => {
      const requestKey = `session-${index}`;
      return scheduleSessionSnapshot({
        workspaceId: "burst-workspace",
        requestKey,
        priority: "prefetch",
        run: async () => {
          started.push(requestKey);
          if (index === 0) await releaseFirst.promise;
          return requestKey;
        },
      }).catch((error: unknown) => error);
    });

    await settle();
    expect(started).toEqual(["session-0"]);
    releaseFirst.resolve();
    await Promise.all(outcomes);
    expect(started).toEqual(["session-0", "session-18", "session-19"]);
  });
});
