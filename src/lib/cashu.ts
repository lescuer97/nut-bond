import {
  CashuWallet,
  CheckStateEnum,
  hasValidDleq,
  type Proof,
  type Token,
} from "@cashu/cashu-ts";
import { hashToCurve, pointFromHex } from "@cashu/crypto/modules/common";
import { parseSecret } from "@cashu/crypto/modules/common/NUT11";
import type NDK from "@nostr-dev-kit/ndk";
import { proofP2pk } from "@nostr-dev-kit/ndk";

export function getProofsAmount(proofs: Proof[]): number {
  let amount = 0
  for (let i = 0; i < proofs.length; i++) {
    amount += proofs[i].amount
  }
  return amount
}

const schnoorSigPrefix = "02" as const;

export async function swapTokensToLocked(ndk: NDK, wallet: CashuWallet, token: Token): Promise<Token> {
  await wallet.getKeySets();
  const amount = getProofsAmount(token.proofs);

  if (!ndk.activeUser?.pubkey) {
    throw new Error(`No active nip-07 active user`);

  }
  const fees = wallet.getFeesForProofs(token.proofs);

  // lock time for 3 months
  const time = new Date().setMonth(new Date().getMonth() + 3)

  const nums = hashToCurve(pointFromHex(schnoorSigPrefix + ndk.activeUser.pubkey).toRawBytes(true))
  const swapedAmounts = await wallet
    .swap(amount - fees, token.proofs, {
      p2pk: { pubkey: nums.toHex(true), locktime: time, refundKeys: [schnoorSigPrefix + ndk.activeUser.pubkey] },
    })
    .catch((err) => {
      throw new Error(`There was a problem swapping the tokens`, err);
    });


  const swappedProofs = [...swapedAmounts.keep, ...swapedAmounts.send];
  const swappedToken: Token = { mint: token.mint, proofs: swappedProofs }

  return swappedToken
}

export async function verifyProofP2PKAndLock(proofs: Proof[], nostrPubkey: string, wallet: CashuWallet): Promise<{ validProofs: Proof[], noTimelockProofs: Proof[] }> {
  var proofWithoutTimelock: Proof[] = []
  var validProofs: Proof[] = []


  for (let i = 0; i < proofs.length; i++) {
    const proof = proofs[i];
    const mintKey = await wallet.getKeys(proof.id)
    if (!mintKey) {
      throw new Error(`No keyset available for the mint. ID: ${proof.id} `);
    }
    const valid = hasValidDleq(proof, mintKey);
    if (!valid) {
      throw new Error("Dleqs in your proofs are not valid");
    }

    // check if verifies to pubkey
    const secret = parseSecret(proof.secret)
    const pubkey = secret[1].data
    if (!secret[1].data) {
      throw new Error("Proof is not locked to pubkey");
    }

    const hashedPubkey = hashToCurve(pointFromHex(schnoorSigPrefix + nostrPubkey).toRawBytes(true))
    if (pubkey != hashedPubkey.toHex(true)) {
      throw new Error("ecash is not locked to the pubkey of the signer");
    }

    const now = new Date().getTime();

    // get timelock
    let timelock: number | undefined = undefined
    secret[1].tags?.forEach((tag) => {
      if (tag[0] == "locktime") {
        timelock = Number(tag[1])
        return
      }
    })

    if (timelock && now > timelock) {
      proofWithoutTimelock.push(proof)

    } else {
      validProofs.push(proof)
    }
  }

  return { noTimelockProofs: proofWithoutTimelock, validProofs: validProofs }
}

export async function verifyProofState(proofs: Proof[], wallet: CashuWallet): Promise<Proof[]> {
  let proofCopy = proofs
  // check if cashu is locked to 
  const states = await wallet.checkProofsStates(proofCopy)

  for (let i = 0; i < states.length; i++) {
    const state = states[i];
    if (state.state != CheckStateEnum.PENDING) {
      const newArray = [...proofs];
      newArray.splice(i, 1);
      proofCopy = newArray
    }
  }

  return proofCopy
}




// check first if the proofs is timelock if the timelock passed check the state of the proof
export async function getAmountFromValidTokens(token: Token, nostrPubkey: string, wallet: CashuWallet): Promise<number> {
  const proofResults = await verifyProofP2PKAndLock(token.proofs, nostrPubkey, wallet)
  if (proofResults.noTimelockProofs.length > 0) {
    const validProofs = await verifyProofState(proofResults.noTimelockProofs, wallet)

    proofResults.validProofs = [...proofResults.validProofs, ...validProofs]
  }

  const amount = getProofsAmount(proofResults.validProofs)

  return amount
}
