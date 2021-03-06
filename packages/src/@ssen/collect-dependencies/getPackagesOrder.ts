import { PackageJson } from 'type-fest';

interface PackageJsonSet {
  name: string;
  dependencies: Set<string>;
}

function compare(a: PackageJsonSet, b: PackageJsonSet): number {
  const aIsHigher: number = 1;
  const bIsHigher: number = -1;

  const aHasB: boolean = a.dependencies.has(b.name);
  const bHasA: boolean = b.dependencies.has(a.name);

  if (!aHasB && !bHasA) {
    return a.name > b.name ? aIsHigher : bIsHigher;
  }

  // FIXME useless interdependent check. the circularly dependencies already checked in searchNestedDependencies()
  //if (aHasB && bHasA) {
  //  throw new Error(
  //    `"${a.name}" dependent "${b.name}" and "${b.name}" dependent "${a.name}". packages can't be interdependent.`,
  //  );
  //}

  return aHasB ? aIsHigher : bIsHigher;
}

function sort(array: PackageJsonSet[]): PackageJsonSet[] {
  if (array.length < 2) {
    return array;
  }
  const chosenIndex: number = array.length - 1;
  const chosen: PackageJsonSet = array[chosenIndex];
  const a: PackageJsonSet[] = [];
  const b: PackageJsonSet[] = [];
  for (let i: number = 0; i < chosenIndex; i++) {
    const temp: PackageJsonSet = array[i];

    compare(temp, chosen) < 0 ? a.push(temp) : b.push(temp);
  }

  return [...sort(a), chosen, ...sort(b)];
}

interface Params {
  packageJsonContents: PackageJson[];
}

export function getPackagesOrder({ packageJsonContents }: Params): string[] {
  function searchNestedDependencies(
    ownerName: string,
    dependencies: PackageJson.Dependency | undefined,
    dependenciesSet: Set<string>,
    parents: string[],
  ): Set<string> {
    if (dependencies) {
      const dependencyNames: string[] = Object.keys(dependencies);

      for (const dependencyName of dependencyNames) {
        if (dependencyName === ownerName) {
          throw new Error(
            `package.json files have circularly referenced dependencies : "${ownerName}" in "${parents.join(
              ' < ',
            )} < ${dependencyName}"`,
          );
        }

        dependenciesSet.add(dependencyName);

        // find dependencyName on the packageJsonContents
        const childPackageJson:
          | PackageJson
          | undefined = packageJsonContents.find(
          ({ name }) => dependencyName === name,
        );

        // if childPackageJson is exists search childPackageJson's dependencies
        if (childPackageJson && childPackageJson.dependencies) {
          searchNestedDependencies(
            ownerName,
            childPackageJson.dependencies,
            dependenciesSet,
            [...parents, dependencyName],
          );
        }
      }
    }

    return dependenciesSet;
  }

  // FIXME avoid Node.js 10 sort error
  const array: PackageJsonSet[] = packageJsonContents.map<PackageJsonSet>(
    (packageJson) => {
      if (!packageJson.name)
        throw new Error(`Undefined "name" field on ${packageJson}`);
      return {
        name: packageJson.name,
        dependencies: searchNestedDependencies(
          packageJson.name,
          packageJson.dependencies,
          new Set(),
          [packageJson.name],
        ),
      };
    },
  );

  return sort(array).map(({ name }) => name);
}
