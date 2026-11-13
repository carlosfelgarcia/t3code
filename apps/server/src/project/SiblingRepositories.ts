import type { ProjectListSiblingRepositoriesInput, SiblingRepository } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as RepositoryIdentityResolver from "./RepositoryIdentityResolver.ts";

const SCAN_CONCURRENCY = 8;

export class SiblingRepositories extends Context.Service<
  SiblingRepositories,
  {
    readonly list: (
      input: ProjectListSiblingRepositoriesInput,
    ) => Effect.Effect<ReadonlyArray<SiblingRepository>>;
  }
>()("t3/project/SiblingRepositories") {}

const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const identities = yield* RepositoryIdentityResolver.RepositoryIdentityResolver;

  const isRepository = (directory: string) =>
    fileSystem.exists(path.join(directory, ".git")).pipe(Effect.orElseSucceed(() => false));

  const list = Effect.fn("SiblingRepositories.list")(function* (
    input: ProjectListSiblingRepositoriesInput,
  ) {
    const root = path.resolve(input.cwd);
    const parent = path.dirname(root);
    const ownName = path.basename(root);
    const names = yield* fileSystem
      .readDirectory(parent)
      .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
    const candidates = names
      .filter((name) => name !== ownName)
      .toSorted((left, right) => left.localeCompare(right));
    const repositories = yield* Effect.filter(
      candidates.map((name) => ({ name, path: path.join(parent, name) })),
      (candidate) => isRepository(candidate.path),
      { concurrency: SCAN_CONCURRENCY },
    );
    return yield* Effect.forEach(
      repositories,
      (repository) =>
        identities
          .resolve(repository.path)
          .pipe(Effect.map((repositoryIdentity) => ({ ...repository, repositoryIdentity }))),
      { concurrency: SCAN_CONCURRENCY },
    );
  });

  return SiblingRepositories.of({ list });
});

export const layer = Layer.effect(SiblingRepositories, make);
