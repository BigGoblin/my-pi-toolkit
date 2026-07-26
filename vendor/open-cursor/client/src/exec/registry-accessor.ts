import type { ExecManager } from "./manager.js";

export interface ResourceLike {
  readonly symbol: symbol;
  registerControlledImplementation(
    implementation: unknown,
    controlledExecManager: ExecManager,
  ): void;
}

export interface ResourceAccessor {
  entries(): Array<[ResourceLike, unknown]>;
}

class ResourceDescriptor {
  constructor(
    public readonly resource: ResourceLike,
    public readonly value: unknown,
  ) {}
}

export class RegistryAccessor implements ResourceAccessor {
  private readonly resources = new Map<symbol, ResourceDescriptor>();

  register(resource: ResourceLike, value: unknown): void {
    this.resources.set(resource.symbol, new ResourceDescriptor(resource, value));
  }

  get(resource: ResourceLike): unknown | undefined {
    return this.resources.get(resource.symbol)?.value;
  }

  entries(): Array<[ResourceLike, unknown]> {
    return Array.from(this.resources.values()).map((desc) => [desc.resource, desc.value]);
  }
}
