function refreshMessageBlock() {
    return [
        {
            type: "section",
            text: {
                type: "mrkdwn",
                text: `🔄 This thread has been refreshed successfully.`,
            },
            accessory: {
                type: "button",
                text: {
                    type: "plain_text",
                    text: "❌ Dismiss",
                    emoji: true,
                },
                value: "dismiss_message",
                action_id: "dismiss_success",
            },
        },
    ];
}

function deleteMessageBlock() {
    return [
        {
            type: "section",
            text: {
                type: "mrkdwn",
                text: `🗑 This thread has been deleted successfully.`,
            },
            accessory: {
                type: "button",
                text: {
                    type: "plain_text",
                    text: "❌ Dismiss",
                    emoji: true,
                },
                value: "dismiss_message",
                action_id: "dismiss_success",
            },
        },
    ];
}

function savedMessageBlock() {
    return [
        {
            type: "section",
            text: {
                type: "mrkdwn",
                text: `✅ This thread has been saved successfully.`,
            },
            accessory: {
                type: "button",
                text: {
                    type: "plain_text",
                    text: "❌ Dismiss",
                    emoji: true,
                },
                value: "dismiss_message",
                action_id: "dismiss_success",
            },
        },
    ];
}

function errorMessageBlock(error) {
    return [
        {
            type: "section",
            text: {
                type: "mrkdwn",
                text: `⚠️ ${error}`,
            },
            accessory: {
                type: "button",
                text: {
                    type: "plain_text",
                    text: "❌ Dismiss",
                    emoji: true,
                },
                value: "dismiss_message",
                action_id: "dismiss_success",
            },
        },
    ];
}

function paymailSetMessageBlock() {
    return [
        {
            type: "section",
            text: {
                type: "mrkdwn",
                text: `✅ Paymail set successfully.`,
            },
            accessory: {
                type: "button",
                text: {
                    type: "plain_text",
                    text: "❌ Dismiss",
                    emoji: true,
                },
                value: "dismiss_message",
                action_id: "dismiss_success",
            },
        },
    ];
}

function paymailRemovedMessageBlock() {
    return [
        {
            type: "section",
            text: {
                type: "mrkdwn",
                text: `🗑 Paymail removed successfully.`,
            },
            accessory: {
                type: "button",
                text: {
                    type: "plain_text",
                    text: "❌ Dismiss",
                    emoji: true,
                },
                value: "dismiss_message",
                action_id: "dismiss_success",
            },
        },
    ];
}

function usernameSetMessageBlock() {
    return [
        {
            type: "section",
            text: {
                type: "mrkdwn",
                text: `✅ Username set successfully.`,
            },
            accessory: {
                type: "button",
                text: {
                    type: "plain_text",
                    text: "❌ Dismiss",
                    emoji: true,
                },
                value: "dismiss_message",
                action_id: "dismiss_success",
            },
        },
    ];
}

module.exports = {
    refreshMessageBlock,
    deleteMessageBlock,
    savedMessageBlock,
    errorMessageBlock,
    paymailSetMessageBlock,
    paymailRemovedMessageBlock,
    usernameSetMessageBlock,
}
