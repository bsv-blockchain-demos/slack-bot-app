function filterThreadMessages(messages) {
    return messages.map(({ text, ts }) => ({ text, ts }));
}

function createFilteredThreadInfo({ thread_ts, channel, saved_by, messages, last_updated }) {
    return {
        thread_ts,
        channel,
        saved_by,
        last_updated,
        messages: filterThreadMessages(messages),
    };
}

module.exports = {
    createFilteredThreadInfo,
}
