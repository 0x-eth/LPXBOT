import { apiContractPackage } from "@lpbot/api-contract";
import { chainRegistryPackage } from "@lpbot/chain-registry";
import { domainPackage } from "@lpbot/domain";

export const testFixturesPackage = {
  contract: apiContractPackage.name,
  domain: domainPackage.name,
  name: "@lpbot/test-fixtures",
  registry: chainRegistryPackage.name,
} as const;
