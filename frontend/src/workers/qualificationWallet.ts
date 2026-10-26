import {
  computeIdentityFromDerivedSecret,
  computeRoleStatusIndex,
  createSourceFact,
  createSourceTrust,
  decodeQualificationRequest,
  encodeQualificationRequest,
  encryptQualificationPackage,
  decryptQualificationPackage,
  qualificationHandoffPublicKey,
  generateShieldedRandomField,
  normalizeWalletState,
  prepareEligibilityIssue,
  type WalletState,
  type WalletQualificationSource,
  type WalletSourceAttachment,
  type QualificationRequest,
  type ProtocolProof,
  type ProtocolInteger,
} from "@deepfamily/protocol-core";
import { getAddress, getBytes, hexlify, toBeHex } from "ethers";
import { poseidon2 } from "poseidon-lite";
import type { ReceiveChain } from "../shared/clients/receiveChain";
import type { ProtocolProofProvider, ReceiveService } from "../shared/zk/receiveProtocol";
import type {
  WalletCalls,
  WalletStateView,
  QualificationManagementView,
} from "../shared/workers/walletWorkerTypes";

type QualificationMethod = Extract<
  keyof WalletCalls,
  | "walletCreateQualificationRequest"
  | "walletReadQualificationManagement"
  | "walletPrepareSourcePublication"
  | "walletConfirmSourcePublication"
  | "walletImportSourcePackage"
  | "walletPrepareQualificationIssue"
  | "walletConfirmQualificationIssue"
  | "walletPrepareRoleRevocation"
  | "walletExportSourcePackage"
>;
export const QUALIFICATION_WALLET_METHODS: readonly string[] = [
  "walletCreateQualificationRequest",
  "walletReadQualificationManagement",
  "walletPrepareSourcePublication",
  "walletConfirmSourcePublication",
  "walletImportSourcePackage",
  "walletPrepareQualificationIssue",
  "walletConfirmQualificationIssue",
  "walletPrepareRoleRevocation",
  "walletExportSourcePackage",
];
interface QualificationEnvironment {
  wallet: WalletState;
  chain: ReceiveChain;
  service: ReceiveService;
  proofs: ProtocolProofProvider;
  save(
    wallet: WalletState,
    rawPassphrase: string,
  ): Promise<{ state: WalletStateView; backup: Uint8Array }>;
}
const randomId = () => hexlify(crypto.getRandomValues(new Uint8Array(32)));
const padded = (siblings: readonly bigint[]) => [
  ...siblings,
  ...Array<bigint>(64 - siblings.length).fill(0n),
];
function currentRequest(request: QualificationRequest, wallet: WalletState) {
  if (
    request.chainId !== String(wallet.chainId) ||
    BigInt(request.registryAddress) !== wallet.authorizerScope
  )
    throw new Error("Qualification request belongs to another chain or registry");
}
function sourceMaterial(
  source: WalletSourceAttachment | WalletQualificationSource,
  request: QualificationRequest,
) {
  return source.kind === "fact"
    ? createSourceFact({
        childIdentity: request.childIdentity,
        parentIdentity: request.parentIdentity,
        parentVersion: request.parentVersion,
        endorser: BigInt(request.endorser),
        xChild: source.xChild,
        xEndorse: source.xEndorse,
        sourceFactSalt: source.sourceFactSalt,
      })
    : createSourceTrust({
        parentIdentity: request.parentIdentity,
        parentVersion: request.parentVersion,
        endorser: BigInt(request.endorser),
        xTrust: source.xTrust,
        sourceTrustSalt: source.sourceTrustSalt,
      });
}
function roleQueries(source: WalletSourceAttachment | WalletQualificationSource) {
  const entries: Array<{ role: 0 | 1 | 2; secret: bigint }> =
    source.kind === "fact"
      ? [
          { role: 0, secret: BigInt(source.xChild) },
          { role: 1, secret: BigInt(source.xEndorse) },
        ]
      : [{ role: 2, secret: BigInt(source.xTrust) }];
  return entries.map((item) => ({
    ...item,
    roleIndex: computeRoleStatusIndex({
      role: ["child", "endorsement", "trusted"][item.role] as "child" | "endorsement" | "trusted",
      roleSecret: item.secret,
    }),
    commitment: poseidon2([74201n + BigInt(item.role), item.secret]),
  }));
}
async function assertSource(
  source: WalletSourceAttachment | WalletQualificationSource,
  request: QualificationRequest,
  chain: ReceiveChain,
) {
  const bindings = await chain.readQualificationBindings();
  if (
    bindings.sourceAddress !== request.sourceAddress ||
    source.sourceAddress !== request.sourceAddress
  )
    throw new Error("Qualification source deployment changed");
  const statuses = await chain.readRoleStatuses({ roles: roleQueries(source) });
  if (statuses.roles.some((status) => !status.registered || status.revoked))
    throw new Error("Source qualification is unavailable or revoked");
  if (
    source.kind === "fact" &&
    statuses.roles.some((status) => status.controller !== request.endorser)
  )
    throw new Error("Source qualification controller mismatch");
  if (
    source.kind === "trust" &&
    statuses.roles.some(
      (status) =>
        status.parentHash !== request.parentPersonHash ||
        String(status.parentVersion) !== request.parentVersion,
    )
  )
    throw new Error("Source qualification family mismatch");
}
function checkSignals(actual: readonly ProtocolInteger[], expected: readonly bigint[]) {
  if (
    actual.length !== expected.length ||
    actual.some((value, index) => BigInt(value) !== expected[index])
  )
    throw new Error("Qualification proof statement mismatch");
}
function proofResult(
  result: { proof: ProtocolProof; publicSignals: readonly ProtocolInteger[] },
  expected: readonly bigint[],
) {
  checkSignals(result.publicSignals, expected);
  return { proof: result.proof, publicSignals: result.publicSignals.map(BigInt) };
}
async function sourcePackage(source: WalletQualificationSource, chain: ReceiveChain) {
  if (!source.publication) throw new Error("Confirm the source transaction before handing it over");
  const request = decodeQualificationRequest(source.request);
  await assertSource(source, request, chain);
  return encryptQualificationPackage({
    request: source.request,
    source: { ...source, leafIndex: source.publication.leafIndex },
  });
}

/** Lifecycle operations return only encrypted recovery data, public requests and exact chain statements. */
export async function runQualificationWallet<M extends QualificationMethod>(
  method: M,
  input: WalletCalls[M]["input"],
  env: QualificationEnvironment,
): Promise<unknown> {
  const { wallet, chain } = env;
  if (method === "walletCreateQualificationRequest") {
    const parameters = input as WalletCalls["walletCreateQualificationRequest"]["input"];
    if (!wallet.identity)
      throw new Error("Create or restore a family wallet before requesting qualification");
    const identity = computeIdentityFromDerivedSecret({
      identity: wallet.identity.fields,
      identitySuiteId: wallet.identity.identitySuiteId,
      derivedSecretField: wallet.codeRootSecret,
    });
    const parent = await chain.readQualificationParent(parameters.parentPersonHash);
    const nonce = randomId();
    const created = encodeQualificationRequest({
      chainId: wallet.chainId,
      registryAddress: toBeHex(wallet.authorizerScope, 20),
      sourceAddress: parent.sourceAddress,
      childIdentity: identity.identityCommitment,
      parentIdentity: parent.parentIdentity,
      parentVersion: parameters.parentVersion,
      endorser: parameters.endorser,
      nonce,
      recipientPublicKey: await qualificationHandoffPublicKey({ ...wallet, nonce }),
    });
    const next = normalizeWalletState({
      ...wallet,
      qualification: {
        ...wallet.qualification,
        requests: [
          ...wallet.qualification.requests,
          {
            id: created.requestId,
            request: created.request,
            fact: null,
            trust: null,
            issue: null,
            credentialIndex: null,
          },
        ],
      },
    });
    return {
      ...(await env.save(next, parameters.rawPassphrase)),
      request: created.request,
      requestId: created.requestId,
    };
  }
  if (method === "walletReadQualificationManagement") {
    const sources = await Promise.all(
      wallet.qualification.sources.map(async (source) => {
        const request = decodeQualificationRequest(source.request);
        const statuses = source.publication
          ? await chain.readRoleStatuses({ roles: roleQueries(source) })
          : null;
        return {
          id: source.id,
          kind: source.kind,
          requestId: request.requestId,
          request: request.request,
          childPersonHash: request.childPersonHash,
          parentPersonHash: request.parentPersonHash,
          parentVersion: request.parentVersion,
          endorser: request.endorser,
          controller: source.controller,
          published: source.publication !== null,
          revoked: statuses?.roles.some((role) => role.revoked || !role.registered) ?? false,
        };
      }),
    );
    return {
      canRequest: wallet.identity !== null,
      sources,
      requests: wallet.qualification.requests.map((record) => {
        const request = decodeQualificationRequest(record.request);
        return {
          id: record.id,
          request: request.request,
          childPersonHash: request.childPersonHash,
          parentPersonHash: request.parentPersonHash,
          parentVersion: request.parentVersion,
          endorser: request.endorser,
          hasFact: record.fact !== null,
          hasTrust: record.trust !== null,
          issued: record.credentialIndex !== null,
        };
      }),
    } satisfies QualificationManagementView;
  }
  if (method === "walletPrepareSourcePublication") {
    const parameters = input as WalletCalls["walletPrepareSourcePublication"]["input"];
    const request = decodeQualificationRequest(parameters.request);
    currentRequest(request, wallet);
    const controller = getAddress(parameters.controller);
    if (parameters.kind !== "fact" && parameters.kind !== "trust")
      throw new Error("Choose a qualification source role");
    if (
      !(await chain.readQualificationController({
        kind: parameters.kind,
        parentIdentity: request.parentIdentity,
        parentVersion: request.parentVersion,
        endorser: request.endorser,
        actor: controller,
      }))
    )
      throw new Error("The connected wallet cannot issue this qualification source");
    const bindings = await chain.readQualificationBindings();
    if (bindings.sourceAddress !== request.sourceAddress)
      throw new Error("Qualification request belongs to another source deployment");
    let source = parameters.draftId
      ? wallet.qualification.sources.find((item) => item.id === parameters.draftId)
      : wallet.qualification.sources.find(
          (item) =>
            item.request === request.request && item.kind === parameters.kind && !item.publication,
        );
    if (parameters.draftId && !source) throw new Error("Qualification draft is unavailable");
    if (
      source &&
      (source.kind !== parameters.kind ||
        source.request !== request.request ||
        source.controller !== controller ||
        source.publication)
    )
      throw new Error("Qualification draft does not match this source request");
    const families = [...wallet.qualification.families];
    if (!source) {
      const family = families.find(
        (item) =>
          item.parentIdentity === request.parentIdentity &&
          item.parentVersion === request.parentVersion,
      );
      const familySalt =
        parameters.kind === "trust"
          ? (family?.familySalt ?? String(generateShieldedRandomField()))
          : "0";
      if (parameters.kind === "trust" && !family)
        families.push({
          parentIdentity: request.parentIdentity,
          parentVersion: request.parentVersion,
          familySalt,
        });
      source = {
        id: randomId(),
        kind: parameters.kind,
        request: request.request,
        sourceAddress: request.sourceAddress,
        controller,
        xChild: parameters.kind === "fact" ? String(generateShieldedRandomField()) : "0",
        xEndorse: parameters.kind === "fact" ? String(generateShieldedRandomField()) : "0",
        xTrust: parameters.kind === "trust" ? String(generateShieldedRandomField()) : "0",
        sourceFactSalt: parameters.kind === "fact" ? String(generateShieldedRandomField()) : "0",
        sourceTrustSalt: parameters.kind === "trust" ? String(generateShieldedRandomField()) : "0",
        familySalt,
        publication: null,
      };
    }
    const existingMaterial = sourceMaterial(source, request);
    if (
      (await chain.findSourceLeafIndex(
        source.kind === "fact" ? 0 : 1,
        "factLeaf" in existingMaterial ? existingMaterial.factLeaf : existingMaterial.trustLeaf,
      )) !== null
    )
      throw new Error(
        "This source is already published; restore its confirmation before handing it over",
      );
    let proved;
    if (source.kind === "fact") {
      const context = await chain.readSourceFactContext({
        childIdentity: request.childIdentity,
        parentIdentity: request.parentIdentity,
        parentVersion: request.parentVersion,
        endorser: request.endorser,
      });
      const fact = createSourceFact({
        childIdentity: request.childIdentity,
        parentIdentity: request.parentIdentity,
        parentVersion: request.parentVersion,
        endorser: BigInt(request.endorser),
        xChild: source.xChild,
        xEndorse: source.xEndorse,
        sourceFactSalt: source.sourceFactSalt,
      });
      const witness = {
        chainId: wallet.chainId,
        sourceAddress: BigInt(context.sourceAddress),
        childIdentity: BigInt(request.childIdentity),
        parentIdentity: BigInt(request.parentIdentity),
        endorser: BigInt(request.endorser),
        parentVersion: BigInt(request.parentVersion),
        endorsementRoot: context.endorsementRoot,
        childVersion: context.childVersion,
        fatherIdentity: context.fatherIdentity,
        motherIdentity: context.motherIdentity,
        rootIsMother: context.rootIsMother,
        writtenAt: context.writtenAt,
        endorsementDepth: context.endorsementDepth,
        endorsementIndex: context.endorsementIndex,
        endorsementSiblings: padded(context.endorsementSiblings),
        xChild: fact.xChild,
        xEndorse: fact.xEndorse,
        sourceFactSalt: fact.sourceFactSalt,
      };
      proved = proofResult(await env.proofs.prove("sourceFact", witness), [
        fact.factLeaf,
        fact.childRoleCommitment,
        fact.endorsementRoleCommitment,
        wallet.chainId,
        BigInt(context.sourceAddress),
        BigInt(request.childIdentity),
        BigInt(request.parentIdentity),
        BigInt(request.endorser),
        BigInt(request.parentVersion),
        context.endorsementRoot,
      ]);
    } else {
      const context = await chain.readSourceTrustContext({
        parentIdentity: request.parentIdentity,
        parentVersion: request.parentVersion,
        endorser: request.endorser,
      });
      const trust = createSourceTrust({
        parentIdentity: request.parentIdentity,
        parentVersion: request.parentVersion,
        endorser: BigInt(request.endorser),
        xTrust: source.xTrust,
        sourceTrustSalt: source.sourceTrustSalt,
      });
      proved = proofResult(
        await env.proofs.prove("sourceTrust", {
          chainId: wallet.chainId,
          sourceAddress: BigInt(context.sourceAddress),
          parentIdentity: BigInt(request.parentIdentity),
          endorser: BigInt(request.endorser),
          parentVersion: BigInt(request.parentVersion),
          trustedRoot: context.trustedRoot,
          trustedDepth: context.trustedDepth,
          trustedIndex: context.trustedIndex,
          trustedSiblings: padded(context.trustedSiblings),
          xTrust: trust.xTrust,
          sourceTrustSalt: trust.sourceTrustSalt,
        }),
        [
          trust.trustLeaf,
          trust.trustRoleCommitment,
          wallet.chainId,
          BigInt(context.sourceAddress),
          BigInt(request.parentIdentity),
          BigInt(request.endorser),
          BigInt(request.parentVersion),
          context.trustedRoot,
        ],
      );
    }
    const revocationRoles = [
      ...new Map(
        [
          ...wallet.revocationRoles,
          ...roleQueries(source).map(({ role, secret }) => ({ role, secret })),
        ].map((role) => [`${role.role}:${role.secret}`, role]),
      ).values(),
    ];
    const next = normalizeWalletState({
      ...wallet,
      revocationRoles,
      qualification: {
        ...wallet.qualification,
        families,
        sources: [...wallet.qualification.sources.filter((item) => item.id !== source.id), source],
      },
    });
    return {
      ...(await env.save(next, parameters.rawPassphrase)),
      draftId: source.id,
      kind: source.kind,
      ...proved,
    };
  }
  if (method === "walletConfirmSourcePublication") {
    const parameters = input as WalletCalls["walletConfirmSourcePublication"]["input"];
    const source = wallet.qualification.sources.find((item) => item.id === parameters.draftId);
    if (!source) throw new Error("Qualification source draft is unavailable");
    const request = decodeQualificationRequest(source.request),
      material = sourceMaterial(source, request);
    const leaf = "factLeaf" in material ? material.factLeaf : material.trustLeaf;
    const treeId = source.kind === "fact" ? 0 : 1;
    const confirmed = parameters.transactionHash
      ? await chain.confirmSourcePublication(parameters.transactionHash, { treeId, leaf })
      : await (async () => {
          const leafIndex = await chain.findSourceLeafIndex(treeId, leaf);
          if (leafIndex === null)
            throw new Error("This source transaction has not been confirmed on chain");
          const path = await chain.readSourceProof(treeId, leafIndex);
          if (path.leaf !== leaf) throw new Error("Source recovery membership mismatch");
          return {
            sourceAddress: (await chain.readQualificationBindings()).sourceAddress,
            leafIndex,
            transactionHash: null,
          };
        })();
    if (confirmed.sourceAddress !== source.sourceAddress)
      throw new Error("Source confirmation belongs to another deployment");
    const published = {
      ...source,
      publication: {
        transactionHash: confirmed.transactionHash,
        leafIndex: String(confirmed.leafIndex),
      },
    };
    const encrypted = await sourcePackage(published, chain);
    const next = normalizeWalletState({
      ...wallet,
      qualification: {
        ...wallet.qualification,
        sources: wallet.qualification.sources.map((item) =>
          item.id === source.id ? published : item,
        ),
      },
    });
    return { ...(await env.save(next, parameters.rawPassphrase)), package: encrypted };
  }
  if (method === "walletExportSourcePackage") {
    const source = wallet.qualification.sources.find(
      (item) => item.id === (input as WalletCalls["walletExportSourcePackage"]["input"]).sourceId,
    );
    if (!source) throw new Error("Qualification source is unavailable");
    return { package: await sourcePackage(source, chain) };
  }
  if (method === "walletImportSourcePackage") {
    const parameters = input as WalletCalls["walletImportSourcePackage"]["input"];
    const bytes = getBytes(parameters.package);
    if (bytes.length !== 549) throw new Error("Invalid encrypted qualification package");
    const requestId = hexlify(bytes.subarray(5, 37)),
      record = wallet.qualification.requests.find((item) => item.id === requestId);
    if (!record) throw new Error("This wallet has no matching qualification request");
    const request = decodeQualificationRequest(record.request);
    const source = await decryptQualificationPackage({
      wallet,
      request: record.request,
      package: bytes,
    });
    await assertSource(source, request, chain);
    const material = sourceMaterial(source, request),
      path = await chain.readSourceProof(source.kind === "fact" ? 0 : 1, source.leafIndex);
    if (path.leaf !== ("factLeaf" in material ? material.factLeaf : material.trustLeaf))
      throw new Error("Source package does not authenticate the requested subject and family");
    const previous = record[source.kind];
    if (previous && JSON.stringify(previous) !== JSON.stringify(source))
      throw new Error("Create a new request to replace an existing source qualification");
    const next = normalizeWalletState({
      ...wallet,
      qualification: {
        ...wallet.qualification,
        requests: wallet.qualification.requests.map((item) =>
          item.id === record.id ? { ...item, [source.kind]: source } : item,
        ),
      },
    });
    return { ...(await env.save(next, parameters.rawPassphrase)), requestId };
  }
  if (method === "walletPrepareQualificationIssue") {
    const parameters = input as WalletCalls["walletPrepareQualificationIssue"]["input"];
    const record = wallet.qualification.requests.find((item) => item.id === parameters.requestId);
    if (!wallet.identity || !record?.fact || !record.trust)
      throw new Error("Import both authenticated source qualifications before issuing");
    if (record.credentialIndex !== null)
      throw new Error("This qualification is already issued; create a new request to reissue");
    const request = decodeQualificationRequest(record.request);
    await assertSource(record.fact, request, chain);
    await assertSource(record.trust, request, chain);
    const paths = await chain.readSourcePaths(record.fact.leafIndex, record.trust.leafIndex);
    const fact = sourceMaterial(record.fact, request),
      trust = sourceMaterial(record.trust, request);
    if (
      !("factLeaf" in fact) ||
      !("trustLeaf" in trust) ||
      paths.sourcePath.leaf !== fact.factLeaf ||
      paths.trustedPath.leaf !== trust.trustLeaf
    )
      throw new Error("Qualification source membership changed");
    const privateInput = {
      identity: wallet.identity.fields,
      identitySuiteId: wallet.identity.identitySuiteId,
      derivedSecretField: wallet.codeRootSecret,
      chainId: wallet.chainId,
      authorizerScope: wallet.authorizerScope,
      parentIdentity: request.parentIdentity,
      parentVersion: request.parentVersion,
      endorser: BigInt(request.endorser),
      familySalt: record.trust.familySalt,
      xChild: record.fact.xChild,
      xEndorse: record.fact.xEndorse,
      xTrust: record.trust.xTrust,
      sourceFactSalt: record.fact.sourceFactSalt,
      sourceTrustSalt: record.trust.sourceTrustSalt,
      sourcePath: paths.sourcePath,
      trustedPath: paths.trustedPath,
      issueNonce: record.issue?.issueNonce ?? generateShieldedRandomField(),
      credentialSalt: record.issue?.credentialSalt ?? generateShieldedRandomField(),
    };
    const prepared = prepareEligibilityIssue(privateInput);
    if ((await chain.findCredentialIndex(prepared.credentialCommitment)) !== null)
      throw new Error("This qualification is already registered; restore its confirmation");
    const result = proofResult(await env.service.proveIssue(privateInput), prepared.publicSignals);
    const issue = {
      issueNonce: String(prepared.witness.issueNonce),
      credentialSalt: String(prepared.witness.credentialSalt),
      credentialCommitment: String(prepared.credentialCommitment),
      familyRoot: String(prepared.familyRoot),
    };
    if (record.issue && JSON.stringify(record.issue) !== JSON.stringify(issue))
      throw new Error("Qualification issuance opening changed");
    const next = normalizeWalletState({
      ...wallet,
      qualification: {
        ...wallet.qualification,
        requests: wallet.qualification.requests.map((item) =>
          item.id === record.id ? { ...item, issue } : item,
        ),
      },
    });
    return { ...(await env.save(next, parameters.rawPassphrase)), requestId: record.id, ...result };
  }
  if (method === "walletConfirmQualificationIssue") {
    const parameters = input as WalletCalls["walletConfirmQualificationIssue"]["input"];
    const record = wallet.qualification.requests.find((item) => item.id === parameters.requestId);
    if (!record?.issue || !record.fact || !record.trust)
      throw new Error("Prepare this qualification issuance before confirming");
    const request = decodeQualificationRequest(record.request);
    const confirmed = parameters.transactionHash
      ? await chain.confirmCredentialRegistration(parameters.transactionHash, {
          credential: record.issue.credentialCommitment,
        })
      : await (async () => {
          const credentialIndex = await chain.findCredentialIndex(
            record.issue!.credentialCommitment,
          );
          if (credentialIndex === null)
            throw new Error("This qualification transaction has not been confirmed on chain");
          return {
            credentialIndex,
            credentialCommitment: BigInt(record.issue!.credentialCommitment),
          };
        })();
    const path = await chain.readCredentialProof(confirmed.credentialIndex);
    if (String(path.leaf) !== record.issue.credentialCommitment)
      throw new Error("Qualification registration membership mismatch");
    if (
      !(await chain.checkClaimQualification({
        issuanceRoot: path.root,
        childRoleIndex: computeRoleStatusIndex({ role: "child", roleSecret: record.fact.xChild }),
        endorsementRoleIndex: computeRoleStatusIndex({
          role: "endorsement",
          roleSecret: record.fact.xEndorse,
        }),
        trustedRoleIndex: computeRoleStatusIndex({
          role: "trusted",
          roleSecret: record.trust.xTrust,
        }),
      }))
    )
      throw new Error("This qualification was revoked before confirmation");
    const credential = {
      issueNonce: BigInt(record.issue.issueNonce),
      credentialSalt: BigInt(record.issue.credentialSalt),
      familyRoot: BigInt(record.issue.familyRoot),
      endorser: BigInt(request.endorser),
      parentVersion: BigInt(request.parentVersion),
      xChild: BigInt(record.fact.xChild),
      xEndorse: BigInt(record.fact.xEndorse),
      xTrust: BigInt(record.trust.xTrust),
      credentialCommitment: confirmed.credentialCommitment,
      credentialIndex: confirmed.credentialIndex,
    };
    const next = normalizeWalletState({
      ...wallet,
      credentials: [
        ...wallet.credentials.filter(
          (item) => item.credentialCommitment !== credential.credentialCommitment,
        ),
        credential,
      ],
      qualification: {
        ...wallet.qualification,
        requests: wallet.qualification.requests.map((item) =>
          item.id === record.id
            ? { ...item, credentialIndex: String(confirmed.credentialIndex) }
            : item,
        ),
      },
    });
    return env.save(next, parameters.rawPassphrase);
  }
  if (method === "walletPrepareRoleRevocation") {
    const parameters = input as WalletCalls["walletPrepareRoleRevocation"]["input"];
    const source = wallet.qualification.sources.find((item) => item.id === parameters.sourceId);
    if (!source?.publication) throw new Error("Confirm this source before revoking its roles");
    const request = decodeQualificationRequest(source.request);
    const selected = parameters.withdrawRelationship
      ? wallet.qualification.sources.filter((item) => {
          const candidate = decodeQualificationRequest(item.request);
          return (
            item.kind === source.kind &&
            item.controller === source.controller &&
            item.publication !== null &&
            candidate.endorser === request.endorser &&
            (source.kind === "fact"
              ? candidate.childIdentity === request.childIdentity
              : candidate.parentIdentity === request.parentIdentity &&
                candidate.parentVersion === request.parentVersion)
          );
        })
      : [source];
    const queries = [
      ...new Map(
        selected.flatMap(roleQueries).map((role) => [`${role.role}:${role.secret}`, role]),
      ).values(),
    ];
    const statuses = await chain.readRoleStatuses({ roles: queries });
    const active = queries.filter(
      (_, index) => statuses.roles[index]?.registered && !statuses.roles[index].revoked,
    );
    if (!active.length) throw new Error("These source roles have already been revoked");
    const mutation = !parameters.withdrawRelationship
      ? undefined
      : source.kind === "fact"
        ? { kind: "cancelEndorsement" as const, childIdentity: BigInt(request.childIdentity) }
        : {
            kind: "removeTrustedEndorser" as const,
            parentIdentity: BigInt(request.parentIdentity),
            parentVersion: BigInt(request.parentVersion),
            endorser: request.endorser,
          };
    return {
      roles: active.map((item) => item.role),
      secrets: active.map((item) => item.secret),
      ...(mutation ? { mutation } : {}),
    };
  }
  throw new Error("Unsupported qualification wallet operation");
}
