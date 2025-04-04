# Cashu bond

Simple proof of concept of identity bonds using Cashu. 

## Description
NOTE: Currently the code only runs on local relay.

When you submit an unlocked token to the website, it verifies and then lock this proofs to the npub in your browser extension and then publish this locked token to a NOSTR Event.

The structure of the proof lock is the following:
```
{
   data: h2c(npub)
   tags: [
            ["timelock", "<unix timestamp (3 months in the future)>"]
            ["refund", ["<npub>"]],
}
```
You can search an npub and as long as you know the Mint's keys you are able to verify that the proofs the user has are
correctly locked and real. if the locks have already expired the code will go and check with the mint if the proofs are
valid. 


## Install the code

Run: 
```
pnpm i

```
## Run the code 
```
pnpm run dev
```
