import { SourceRegistry } from '../../server/src/services/source-registry';
import { DummyDataSource } from './dummy-data-source';
import { source1Rows } from './source1';
import { source2Rows } from './source2';
import { source3Rows } from './source3';

/**
 * The app no longer ships dummy sources: they exist only so the selection tests
 * keep a fixed, hand-checkable 72-row distribution to assert against.
 */
export function fixtureRegistry(): SourceRegistry {
  const registry = new SourceRegistry({ includePreparedSources: false });
  registry.register(new DummyDataSource('source1', source1Rows));
  registry.register(new DummyDataSource('source2', source2Rows));
  registry.register(new DummyDataSource('source3', source3Rows));
  return registry;
}
