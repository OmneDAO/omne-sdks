import { setPlatformProviders } from './platform/context';
import { createBrowserPlatformProviders } from './platform/browser';

setPlatformProviders(createBrowserPlatformProviders());

export * from './index';
