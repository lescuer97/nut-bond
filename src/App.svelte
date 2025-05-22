<script lang="ts">
  import NDK, {
    NDKEvent,
    NDKKind,
    NDKNip07Signer,
    type NDKTag,
  } from "@nostr-dev-kit/ndk";
  import {
    CashuMint,
    CashuWallet,
    getDecodedToken,
    getEncodedToken,
    type MintKeys,
  } from "@cashu/cashu-ts";
  import {
    getAmountFromValidTokens,
    swapTokensToLocked,
    verifyProofP2PKAndLock,
  } from "./lib/cashu";
  import * as nip19 from "nostr-tools/nip19";

  const localRelay = "ws://localhost:4869" as const;
  const nip07signer = new NDKNip07Signer();
  var ndk = new NDK({
    signer: nip07signer,
    explicitRelayUrls: [localRelay],
    enableOutboxModel: true,
  });

  ndk.connect().then(async () => {
    const user = await ndk.signer?.user();
    ndk.activeUser = user;
  });

  type UserMetadata = {
    name?: string;
    about?: string;
    picture?: string;
    display_name?: string;
    bot?: string;
  };

  const CashuBondKind = 1972;
  let user: string = $state("");
  let pubkeyOfUsersToSearch: string = $state("");

  let tokenStr: string = $state("");
  let bondCreationError: string = $state("");

  let bondAmounts: { [key: string]: number } = $state({});
  let userMetadata: UserMetadata | undefined = $state();

  function getBondEvent() {
    bondAmounts = {}
    const { type, data } = nip19.decode(user);

    if (type != "npub") {
      throw new Error("did not submit npub");
    }

    pubkeyOfUsersToSearch = data;
    const userMetadataSub = ndk.subscribe(
      { authors: [pubkeyOfUsersToSearch], kinds: [0] },
      { closeOnEose: false },
    );

    userMetadataSub.on("event", (event) => {
      userMetadata = JSON.parse(event.content);
    });

    userMetadataSub.on("close", () => console.log("Subscription closed"));

    const subListings = ndk.subscribe(
      { authors: [pubkeyOfUsersToSearch], kinds: [CashuBondKind as NDKKind] },
      { closeOnEose: false },
    );

    subListings.on("event", async (event) => {
      const parsedToken = getDecodedToken(event.tagValue("token") ?? "");
      if (parsedToken) {
        const mint = new CashuMint(parsedToken.mint);
        // get active mint keys
        await mint.getKeys();
        const wallet = new CashuWallet(mint);

        const amount = await getAmountFromValidTokens(
          parsedToken,
          pubkeyOfUsersToSearch,
          wallet,
        );

        const currAmount = bondAmounts[parsedToken.unit ?? "sat"];
        if (!currAmount) {
          bondAmounts[parsedToken.unit ?? "sat"] = amount;
        } else {
          bondAmounts[parsedToken.unit ?? "sat"] = amount + currAmount;
        }
      }
    }); // Show the content

    subListings.on("close", () => console.log("Subscription closed"));
  }

  async function CreateBond() {
    if (!ndk.activeUser?.pubkey) {
      bondCreationError = `There is no active user form nip-07 extension`;
      return;
    }
    // parse string to cashu token
    const token = getDecodedToken(tokenStr);

    const mint = new CashuMint(token.mint);
    await mint.getKeys();
    const wallet = new CashuWallet(mint);

    const swappedToken = await swapTokensToLocked(ndk, wallet, token);

    const valid = verifyProofP2PKAndLock(
      swappedToken.proofs,
      ndk.activeUser.pubkey,
      wallet,
    );

    if (!valid) {
      bondCreationError = `Proofs are not valid`;
      return;
    }

    const pTag: NDKTag = ["p", `${ndk.activeUser.pubkey}`];
    const proofsTag: NDKTag = ["token", getEncodedToken(swappedToken)];
    const mintUrlTag: NDKTag = ["u", token.mint];
    let tags: NDKTag[] = [pTag, proofsTag, mintUrlTag];
    // make event
    const event = new NDKEvent(ndk, {
      kind: CashuBondKind,
      content: "Cashu User Bond",
      tags,
      created_at: Date.now(),
      pubkey: ndk.activeUser?.pubkey,
    });
    await event.publish();
  }


  let is_locked_to_bond = $derived(Object.keys(bondAmounts).length > 0)
</script>

<main>
  <h1>CASHU BOND</h1>
  <div class="create-bond">
    <h3>Create Bond for your NOSTR user</h3>

    <textarea class="input" bind:value={tokenStr}> </textarea>
    <button onclick={CreateBond} disabled={tokenStr === ""}>Make Bond</button>
  </div>

  <div class="user-check">
    <h3>Does this nostr user have a cashu locked bond?</h3>
    <input class="input" bind:value={user} type="text" />
    <button type="button" onclick={getBondEvent}>Search</button>
  </div>

  {#if userMetadata}
    <div class="user-info">
      {#if userMetadata?.picture}
        <div class="profile-container">
          <img
            class={`profile-picture ${is_locked_to_bond ? "locked-bond":""}`}
            src={userMetadata?.picture}
            alt="profile"
          />
      {#if is_locked_to_bond}
          <div class="badge">
            <img src="/cashu-150x150.png" alt="Badge Icon" />
          </div>
      {/if}
        </div>
      {/if}
      {#if userMetadata?.name}
        <p class="name">{userMetadata.name}</p>
      {/if}
      {#if userMetadata?.display_name}
        <p class="name">Display name: {userMetadata.display_name}</p>
      {/if}

      {#if is_locked_to_bond}
        <h2>This Nostr account has:</h2>
        {#each Object.entries(bondAmounts) as [unit, value]}
          <div class="amount">
            <strong>{value} {unit} </strong> Locked.
          </div>
        {/each}
      {/if}
    </div>
  {/if}
</main>

<style>
  main {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 20px;
  }

  .create-bond {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-width: 450px;
    gap: 10px;
  }
  .create-bond textarea {
    width: 100%;
    height: 100px;
    word-break: break-all;
  }

  .user-check {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-width: 450px;
    gap: 10px;
  }
  .user-check input {
    width: 100%;
    height: 28px;
    font-size: 20ppx;
  }

  .user-info {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    gap: 10px;
    border: 1px solid white;
    padding: 10px;
  }

  .user-info .name {
    font-size: 24px;
    margin-top: 5px;
    margin-bottom: 5px;
  }
  .amount {
    font-size: 24px;
  }

  .profile-container {
    position: relative;
    width: 100px;
    height: 100px;
    margin: 10px auto;
  }

  .profile-picture {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    object-fit: cover;
    border: 3px solid white;
  }

  .locked-bond {
    border: 3px solid #f7931a;
  }

  .badge {
    position: absolute;
    bottom: 0;
    right: 0;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background-color: #763cc3;
    padding: 2px;
    border: 3px solid #f7931a;
    overflow: hidden;
  }

  .badge img {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    object-fit: cover;
  }
</style>
