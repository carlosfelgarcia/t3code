import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ProcessRunner from "../processRunner.ts";
import * as RepositoryIdentityResolver from "./RepositoryIdentityResolver.ts";
import * as SiblingRepositories from "./SiblingRepositories.ts";

const git = (cwd: string, args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const processRunner = yield* ProcessRunner.ProcessRunner;
    return yield* processRunner.run({ command: "git", args: ["-C", cwd, ...args] });
  }).pipe(Effect.provide(ProcessRunner.layer));

const testLayer = SiblingRepositories.layer.pipe(
  Layer.provide(RepositoryIdentityResolver.layer),
  Layer.provideMerge(NodeServices.layer),
);

it.layer(testLayer)("SiblingRepositories", (it) => {
  it.effect("lists the Git repositories beside a project, without the project itself", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const parent = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-siblings-test-" });
      const project = path.join(parent, "home");
      const oasis = path.join(parent, "oasis");
      const memento = path.join(parent, "memento");
      for (const directory of [project, oasis, path.join(parent, "notes")]) {
        yield* fileSystem.makeDirectory(directory);
      }
      yield* git(project, ["init"]);
      yield* git(oasis, ["init"]);
      yield* git(oasis, ["remote", "add", "origin", "git@github.com:Acme/oasis.git"]);
      yield* git(oasis, [
        "-c",
        "user.name=T3",
        "-c",
        "user.email=t3@example.com",
        "commit",
        "--allow-empty",
        "-m",
        "init",
      ]);
      // A linked worktree has a `.git` file instead of a folder.
      yield* git(oasis, ["worktree", "add", memento]);
      yield* fileSystem.writeFileString(path.join(parent, "README.md"), "");

      const siblings = yield* SiblingRepositories.SiblingRepositories;
      const repositories = yield* siblings.list({ cwd: project });

      expect(repositories.map(({ name, path }) => ({ name, path }))).toEqual([
        { name: "memento", path: memento },
        { name: "oasis", path: oasis },
      ]);
      expect(repositories[1]?.repositoryIdentity?.canonicalKey).toBe("github.com/acme/oasis");
    }),
  );

  it.effect("lists nothing when the project's parent folder is missing", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-siblings-test-" });

      const siblings = yield* SiblingRepositories.SiblingRepositories;
      const repositories = yield* siblings.list({ cwd: path.join(root, "gone", "home") });

      expect(repositories).toEqual([]);
    }),
  );
});
