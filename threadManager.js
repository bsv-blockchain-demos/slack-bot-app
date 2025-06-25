/**
 * Thread Manager - Handles all operations related to Slack threads in MongoDB
 * Implements the hybrid strategy for thread management with live updates and manual refresh
 */

const { connectToMongo } = require('./mongo.js');

/**
 * Saves a new thread or updates an existing one
 * @param {Object} threadData - Thread data from Slack
 * @param {string} threadData.thread_ts - Thread timestamp (used as _id)
 * @param {string} threadData.channel - Channel ID
 * @param {string} threadData.saved_by - User ID who saved the thread
 * @param {Array} threadData.messages - Array of messages in the thread
 * @param {Object} client - Slack client for API calls
 * @returns {Promise<Object>} - Result of the operation
 */
async function saveThread(threadData, client, response) {
  const { threadsCollection } = await connectToMongo();
  
  // Get simplified user info for the person who saved the thread (only id and real_name)
  const fullSavedByUserInfo = await getUserInfoByID(client, threadData.saved_by || threadData.triggered_by);
  const savedByUserInfo = {
    id: fullSavedByUserInfo.id,
    real_name: fullSavedByUserInfo.profile?.real_name || fullSavedByUserInfo.real_name || (threadData.saved_by || threadData.triggered_by)
  };
  
  // Get unique user IDs from all messages to fetch their info
  const userIds = new Set();
  threadData.messages.forEach(message => {
    if (message.user) userIds.add(message.user);
  });
  
  // Create a map of user IDs to simplified user info objects (only id and real_name)
  const userInfoMap = new Map();
  for (const userId of userIds) {
    try {
      const userInfo = await getUserInfoByID(client, userId);
      // Only store the id and real_name from profile
      userInfoMap.set(userId, {
        id: userInfo.id,
        real_name: userInfo.profile?.real_name || userInfo.real_name || userId
      });
    } catch (error) {
      console.error(`Error fetching user info for ${userId}:`, error);
      // If we can't get user info, we'll still use the ID
    }
  }
  
  // Format messages according to our schema
  const formattedMessages = threadData.messages.map(message => ({
    ts: message.ts,
    user: message.user,
    userInfo: userInfoMap.get(message.user) || null,
    text: message.text || "",
    edited: !!message.edited,
    deleted: false,
    reactions: message.reactions || [],
    votes: {upvotes: [], downvotes: []},
    raw: {files: message.files || [], thread_ts: message.thread_ts}
  }));

  // Extract reactions from parent message (first message)
  const parentReactions = threadData.messages[0]?.reactions?.map(r => r.name) || [];

  // Create the thread document
  const threadDocument = {
    _id: threadData.thread_ts,
    channel: threadData.channel,
    saved_by: threadData.saved_by || threadData.triggered_by,
    saved_by_info: savedByUserInfo,
    saved_at: new Date(),
    last_updated: new Date(),
    reactions: parentReactions,
    messages: formattedMessages,
    createActionResponse: response,
  };

  try {
    // Use upsert to either create a new document or replace an existing one
    const result = await threadsCollection.replaceOne(
      { _id: threadData.thread_ts },
      threadDocument,
      { upsert: true }
    );
    
    return {
      success: true,
      isNew: result.upsertedCount === 1,
      threadTs: threadData.thread_ts,
      result
    };
  } catch (error) {
    console.error("Error saving thread:", error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Adds a new reply to an existing thread
 * @param {string} threadTs - Thread timestamp
 * @param {Object} message - Message object from Slack
 * @param {Object} client - Slack client for API calls
 * @returns {Promise<Object>} - Result of the operation
 */
async function addReply(threadTs, message, client) {
  const { threadsCollection } = await connectToMongo();
  
  // Get simplified user info for the message author (only id and real_name)
  let userInfo = null;
  try {
    if (message.user) {
      const fullUserInfo = await getUserInfoByID(client, message.user);
      // Only store the id and real_name from profile
      userInfo = {
        id: fullUserInfo.id,
        real_name: fullUserInfo.profile?.real_name || fullUserInfo.real_name || message.user
      };
    }
  } catch (error) {
    console.error(`Error fetching user info for ${message.user}:`, error);
    // If we can't get user info, we'll still use the ID
  }
  
  // Format the message according to our schema
  const formattedMessage = {
    ts: message.ts,
    user: message.user,
    userInfo: userInfo,
    text: message.text || "",
    edited: !!message.edited,
    deleted: false,
    reactions: message.reactions || [],
    votes: {upvotes: [], downvotes: []},
    raw: {files: message.files || [], thread_ts: message.thread_ts},
  };

  try {
    const result = await threadsCollection.updateOne(
      { _id: threadTs },
      {
        $push: {
          messages: formattedMessage
        },
        $set: {
          last_updated: new Date()
        }
      }
    );
    
    return {
      success: result.modifiedCount === 1,
      threadTs,
      messageTs: message.ts
    };
  } catch (error) {
    console.error("Error adding reply:", error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Updates an edited message in a thread
 * @param {string} threadTs - Thread timestamp
 * @param {string} messageTs - Message timestamp
 * @param {string} newText - New message text
 * @param {Object} rawMessage - Raw message object from Slack
 * @returns {Promise<Object>} - Result of the operation
 */
async function updateEditedMessage(threadTs, messageTs, newText, rawMessage) {
  const { threadsCollection } = await connectToMongo();
  
  try {
    const result = await threadsCollection.updateOne(
      { _id: threadTs, "messages.ts": messageTs },
      {
        $set: {
          "messages.$.text": newText,
          "messages.$.edited": true,
          "messages.$.raw": rawMessage,
          "last_updated": new Date()
        }
      }
    );
    
    return {
      success: result.modifiedCount === 1,
      threadTs,
      messageTs
    };
  } catch (error) {
    console.error("Error updating edited message:", error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Marks a message as deleted in a thread
 * @param {string} threadTs - Thread timestamp
 * @param {string} messageTs - Message timestamp
 * @param {Object} client - Slack client for API calls
 * @returns {Promise<Object>} - Result of the operation
 */
async function markMessageDeleted(threadTs, messageTs, client) {
  const { threadsCollection } = await connectToMongo();
  
  try {
    const result = await threadsCollection.updateOne(
      { _id: threadTs, "messages.ts": messageTs },
      {
        $set: {
          "messages.$.text": "[deleted]",
          "messages.$.deleted": true,
          "last_updated": new Date()
        }
      }
    );
    
    return {
      success: result.modifiedCount === 1,
      threadTs,
      messageTs
    };
  } catch (error) {
    console.error("Error marking message as deleted:", error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Refreshes an entire thread with new data from Slack
 * @param {string} threadTs - Thread timestamp
 * @param {string} channelId - Channel ID
 * @param {Array} messages - Array of messages from Slack
 * @param {string} userId - User ID who triggered the refresh
 * @param {Object} client - Slack client for API calls
 * @returns {Promise<Object>} - Result of the operation
 */
async function refreshThread(threadTs, channelId, messages, userId, client, response) {
  const { threadsCollection } = await connectToMongo();
  
  try {
    // First check if thread exists to preserve original saved_by and saved_at
    const existingThread = await threadsCollection.findOne({ _id: threadTs });
    
    // Get simplified user info for the person who triggered the refresh (only id and real_name)
    let refreshByUserInfo = null;
    try {
      const fullUserInfo = await getUserInfoByID(client, userId);
      refreshByUserInfo = {
        id: fullUserInfo.id,
        real_name: fullUserInfo.profile?.real_name || fullUserInfo.real_name || userId
      };
    } catch (error) {
      console.error(`Error fetching user info for ${userId}:`, error);
    }
    
    // Get unique user IDs from all messages to fetch their info
    const userIds = new Set();
    messages.forEach(message => {
      if (message.user) userIds.add(message.user);
    });
    
    // Create a map of user IDs to simplified user info objects (only id and real_name)
    const userInfoMap = new Map();
    for (const userId of userIds) {
      try {
        const userInfo = await getUserInfoByID(client, userId);
        // Only store the id and real_name from profile
        userInfoMap.set(userId, {
          id: userInfo.id,
          real_name: userInfo.profile?.real_name || userInfo.real_name || userId
        });
      } catch (error) {
        console.error(`Error fetching user info for ${userId}:`, error);
        // If we can't get user info, we'll still use the ID
      }
    }
    
    // Format messages according to our schema
    const formattedMessages = messages.map(message => ({
      ts: message.ts,
      user: message.user,
      userInfo: userInfoMap.get(message.user) || null,
      text: message.text || "",
      edited: !!message.edited,
      deleted: false, // We don't know if it was deleted, so assume not
      reactions: message.reactions || [],
      votes: message.votes,
      raw: {files: message.files || [], thread_ts: message.thread_ts},
    }));

    // Extract reactions from parent message
    const parentReactions = messages[0]?.reactions?.map(r => r.name) || [];
    
    // Create the updated thread document
    const threadDocument = {
      _id: threadTs,
      channel: channelId,
      saved_by: existingThread?.saved_by || userId,
      saved_at: existingThread?.saved_at || new Date(),
      last_updated: new Date(),
      reactions: parentReactions,
      messages: formattedMessages,
      createActionResponse: response,
    };
    
    // Always ensure saved_by_info exists
    if (existingThread?.saved_by_info) {
      // Use existing saved_by_info if available
      threadDocument.saved_by_info = existingThread.saved_by_info;
    } else if (existingThread?.saved_by) {
      // If thread exists but has no saved_by_info, create it from the saved_by user ID
      try {
        const savedByUserInfo = await getUserInfoByID(client, existingThread.saved_by);
        threadDocument.saved_by_info = {
          id: savedByUserInfo.id,
          real_name: savedByUserInfo.profile?.real_name || savedByUserInfo.real_name || existingThread.saved_by
        };
      } catch (error) {
        // Fallback to basic info if we can't get user details
        threadDocument.saved_by_info = {
          id: existingThread.saved_by,
          real_name: existingThread.saved_by
        };
      }
    } else {
      // For new threads, use the refreshByUserInfo
      threadDocument.saved_by_info = refreshByUserInfo;
    }

    const result = await threadsCollection.replaceOne(
      { _id: threadTs },
      threadDocument,
      { upsert: true }
    );
    
    return {
      success: true,
      threadTs,
      isNew: !existingThread,
      result
    };
  } catch (error) {
    console.error("Error refreshing thread:", error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Gets a thread by its ID (thread_ts)
 * @param {string} threadTs - Thread timestamp
 * @returns {Promise<Object|null>} - Thread document or null if not found
 */
async function getThread(threadTs) {
  const { threadsCollection } = await connectToMongo();
  
  try {
    return await threadsCollection.findOne({ _id: threadTs });
  } catch (error) {
    console.error("Error getting thread:", error);
    return null;
  }
}

/**
 * Checks if a thread exists in the database
 * @param {string} threadTs - Thread timestamp
 * @returns {Promise<boolean>} - True if thread exists, false otherwise
 */
async function threadExists(threadTs) {
  const thread = await getThread(threadTs);
  return !!thread;
}

/**
 * Helper function to get user info by ID (imported from index.js)
 * @param {Object} client - Slack client
 * @param {string} ID - User ID
 * @returns {Promise<Object>} - User info
 */
async function getUserInfoByID(client, ID) {
  try {
    const userInfo = await client.users.info({ user: ID });
    return userInfo.user;
  } catch (error) {
    console.error(`Error fetching user info for ${ID}:`, error);
    throw error;
  }
}

async function deleteThread(threadTs, channel, messages, user) {
  const { threadsCollection } = await connectToMongo();
  
  try {
    const result = await threadsCollection.deleteOne({ _id: threadTs });
    return {
      success: result.deletedCount === 1,
      threadTs,
      channel,
      messages,
      user,
      result
    };
  } catch (error) {
    console.error("Error deleting thread:", error);
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = {
  saveThread,
  addReply,
  updateEditedMessage,
  markMessageDeleted,
  refreshThread,
  getThread,
  threadExists,
  deleteThread
};
