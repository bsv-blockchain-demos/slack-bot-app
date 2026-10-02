# Slack Thread Archiving Bot

A Slack app that saves selected discussion threads in MongoDB and records a hash commitment through a BSV wallet. It supports administrator-controlled save, refresh and removal actions, then tracks replies and edits for saved threads.

The companion [Slack Threads Web App](https://github.com/bsv-blockchain-demos/slack-threads-webapp) provides a browser interface to the stored threads. This repository contains the bot, not the viewer or overlay service.

## Commands and reactions

| Action | Behaviour |
| --- | --- |
| `:inbox_tray:` on a parent message | Save a thread that contains replies. |
| `:arrows_counterclockwise:` | Refresh a saved thread. |
| `:wastebasket:` | Remove a saved thread from MongoDB and attempt to spend its existing commitment output. |
| `/setpaymail` | Set or remove the caller's stored paymail address. |
| `/setusername` | Set the caller's stored display name. |

Reaction actions require the acting Slack user to have `is_admin` set. Message events update saved threads, including marking deleted messages in the stored snapshot. Removing a snapshot does not erase blockchain history.

## Requirements

- Node.js 22 and npm. Native dependencies may require Python and a C/C++ build toolchain.
- A Slack app installed in the target workspace, with Socket Mode enabled.
- MongoDB, a funded BSV demonstration wallet and a compatible wallet storage provider.
- Access to the overlay services configured in the transaction helper.

Configure the app's event subscriptions for reactions and the message types in the conversations it should archive. Register `/setpaymail` and `/setusername`, and grant the relevant conversation-history, user-reading, reaction and message permissions. There is no installable Slack app manifest in this repository. Follow Slack's [Socket Mode setup](https://docs.slack.dev/apis/events-api/using-socket-mode/) and the scope requirements for [reading thread replies](https://docs.slack.dev/reference/methods/conversations.replies/).

## Run locally

```sh
npm ci
```

Create a root `.env` file with your own values:

| Variable | Purpose |
| --- | --- |
| `SLACK_BOT_TOKEN` | Installed app's bot token. |
| `SLACK_APP_TOKEN` | App-level token for Socket Mode. |
| `SLACK_SIGNING_SECRET` | Slack signing secret. |
| `MONGODB_URI` | MongoDB connection string; the code uses database `slackApp`. |
| `SERVER_PRIVATE_KEY` | Hexadecimal private key for the server wallet. |
| `WALLET_STORAGE_URL` | Wallet storage endpoint for the selected network. |
| `CHAIN` | Only `testnet` selects testnet; every other value selects mainnet. |
| `RANDOM_SECRET` | Stable secret used in thread commitments. Keep it consistent with the viewer. |
| `PORT` | Optional app port, default `3000`. |

```sh
npm start
```

Starting the app connects it to Slack and MongoDB. Reactions and message events can create wallet transactions, incur fees and send Slack responses. Use a dedicated workspace and wallet when developing.

## Data and integration limits

MongoDB stores message text and user information. The blockchain output commits to a filtered thread snapshot using a hash puzzle. Restrict database and viewer access to match the intended audience of the archived discussions.

The current thread fetch makes one `conversations.replies` request without following pagination, so long threads may be incomplete. Overlay broadcasting is not awaited by the transaction helper; a successful Slack acknowledgement is not proof that the overlay indexed the transaction.

The overlay host and lookup/topic names are configured in [hooks/transactionHandler.js](hooks/transactionHandler.js). Coordinate those settings, the MongoDB database and `RANDOM_SECRET` with the viewer.

## Development

This is a JavaScript service with no build, lint or test scripts. [index.js](index.js) registers Slack handlers, [hooks/](hooks/) manages threads and transactions, and [src/messageEventHandler.js](src/messageEventHandler.js) handles saved-thread updates. The [Dockerfile](Dockerfile) supplies a Node.js runtime and native build dependencies.

## Licence

**Declared licence: ISC.** See [package.json](package.json). No standalone licence file is included in this repository.
