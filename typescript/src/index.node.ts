import { setPlatformProviders } from './platform/context';
import { createNodePlatformProviders } from './platform/node';

setPlatformProviders(createNodePlatformProviders());

export * from './index';
