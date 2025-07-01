function filterThreadMessages(messages) {
    return messages.map(({ text, ts }) => ({ text, ts }));
}

function createFilteredThreadInfo({ thread_ts, channel, saved_by, messages }) {
    return {
        thread_ts,
        channel,
        saved_by,
        messages: filterThreadMessages(messages),
    };
}

module.exports = {
    createFilteredThreadInfo,
}
