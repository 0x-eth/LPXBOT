import { apiContractPackage } from "@lpbot/api-contract";
import { chainRegistryPackage } from "@lpbot/chain-registry";
import { domainPackage } from "@lpbot/domain";

export const testFixturesPackage = {
  contract: apiContractPackage.name,
  domain: domainPackage.name,
  name: "@lpbot/test-fixtures",
  registry: chainRegistryPackage.name,
} as const;

export { OBSERVED_HELPER_PATHS, ObservedHelperCodec } from "./observed-helper-codec.js";
export type {
  DecodedObservedHelperCalldata,
  ObservedHelperPathDefinition,
  ObservedHelperPathName,
} from "./observed-helper-codec.js";
