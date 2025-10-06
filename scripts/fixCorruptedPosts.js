const mongoose = require('mongoose');
require('dotenv').config();
const Post = require('../models/Post');

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/freetalk', {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

async function fixCorruptedPosts() {
  try {
    console.log('Starting to check for corrupted posts...\n');
    
    // Get all posts
    const posts = await Post.find({}).lean();
    console.log(`Found ${posts.length} posts to check\n`);
    
    let corruptedCount = 0;
    let fixedCount = 0;
    
    for (const post of posts) {
      let needsUpdate = false;
      const updates = {};
      
      // Check comments
      if (post.comments && post.comments.length > 0) {
        const cleanedComments = post.comments.map(comment => {
          let cleanedComment = { ...comment };
          
          // Check if user field is valid ObjectId
          if (comment.user && !mongoose.Types.ObjectId.isValid(comment.user)) {
            console.log(`⚠️  Post ${post._id}: Invalid user in comment: ${comment.user}`);
            needsUpdate = true;
            return null; // Mark for removal
          }
          
          // Check taggedUsers
          if (comment.taggedUsers && comment.taggedUsers.length > 0) {
            cleanedComment.taggedUsers = comment.taggedUsers.filter(userId => {
              if (!mongoose.Types.ObjectId.isValid(userId)) {
                console.log(`⚠️  Post ${post._id}: Invalid taggedUser in comment: ${userId}`);
                needsUpdate = true;
                return false;
              }
              return true;
            });
          }
          
          // Check replies
          if (comment.replies && comment.replies.length > 0) {
            cleanedComment.replies = comment.replies.map(reply => {
              let cleanedReply = { ...reply };
              
              if (reply.user && !mongoose.Types.ObjectId.isValid(reply.user)) {
                console.log(`⚠️  Post ${post._id}: Invalid user in reply: ${reply.user}`);
                needsUpdate = true;
                return null;
              }
              
              if (reply.mentionedUser && !mongoose.Types.ObjectId.isValid(reply.mentionedUser)) {
                console.log(`⚠️  Post ${post._id}: Invalid mentionedUser in reply: ${reply.mentionedUser}`);
                cleanedReply.mentionedUser = undefined;
                needsUpdate = true;
              }
              
              if (reply.taggedUsers && reply.taggedUsers.length > 0) {
                cleanedReply.taggedUsers = reply.taggedUsers.filter(userId => {
                  if (!mongoose.Types.ObjectId.isValid(userId)) {
                    console.log(`⚠️  Post ${post._id}: Invalid taggedUser in reply: ${userId}`);
                    needsUpdate = true;
                    return false;
                  }
                  return true;
                });
              }
              
              // Check nested replies
              if (reply.replies && reply.replies.length > 0) {
                cleanedReply.replies = reply.replies.map(nestedReply => {
                  let cleanedNestedReply = { ...nestedReply };
                  
                  if (nestedReply.user && !mongoose.Types.ObjectId.isValid(nestedReply.user)) {
                    console.log(`⚠️  Post ${post._id}: Invalid user in nested reply: ${nestedReply.user}`);
                    needsUpdate = true;
                    return null;
                  }
                  
                  if (nestedReply.mentionedUser && !mongoose.Types.ObjectId.isValid(nestedReply.mentionedUser)) {
                    console.log(`⚠️  Post ${post._id}: Invalid mentionedUser in nested reply: ${nestedReply.mentionedUser}`);
                    cleanedNestedReply.mentionedUser = undefined;
                    needsUpdate = true;
                  }
                  
                  if (nestedReply.taggedUsers && nestedReply.taggedUsers.length > 0) {
                    cleanedNestedReply.taggedUsers = nestedReply.taggedUsers.filter(userId => {
                      if (!mongoose.Types.ObjectId.isValid(userId)) {
                        console.log(`⚠️  Post ${post._id}: Invalid taggedUser in nested reply: ${userId}`);
                        needsUpdate = true;
                        return false;
                      }
                      return true;
                    });
                  }
                  
                  return cleanedNestedReply;
                }).filter(r => r !== null);
              }
              
              return cleanedReply;
            }).filter(r => r !== null);
          }
          
          return cleanedComment;
        }).filter(c => c !== null);
        
        if (needsUpdate) {
          updates.comments = cleanedComments;
        }
      }
      
      // Update the post if needed
      if (needsUpdate) {
        corruptedCount++;
        try {
          await Post.findByIdAndUpdate(post._id, updates);
          console.log(`✅ Fixed post ${post._id}\n`);
          fixedCount++;
        } catch (err) {
          console.error(`❌ Failed to fix post ${post._id}:`, err.message, '\n');
        }
      }
    }
    
    console.log('\n=== Summary ===');
    console.log(`Total posts checked: ${posts.length}`);
    console.log(`Corrupted posts found: ${corruptedCount}`);
    console.log(`Posts fixed: ${fixedCount}`);
    console.log('===============\n');
    
  } catch (error) {
    console.error('Error fixing corrupted posts:', error);
  } finally {
    await mongoose.connection.close();
    console.log('Database connection closed.');
  }
}

// Run the script
fixCorruptedPosts();
