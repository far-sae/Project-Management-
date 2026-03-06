/**
 * Migration Script: Migrate existing users to personal organizations
 * This script creates personal organizations for existing users and assigns their projects
 */

const admin = require('firebase-admin');

// Initialize Firebase Admin SDK using application default credentials
// Make sure you've authenticated with: firebase login && firebase use PROJECT_ID
admin.initializeApp();

const db = admin.firestore();

async function migrateUsersToOrganizations() {
  console.log('Starting user migration to organizations...');
  
  try {
    // Get all existing users
    const usersSnapshot = await db.collection('users').get();
    console.log(`Found ${usersSnapshot.size} users to migrate`);
    
    for (const userDoc of usersSnapshot.docs) {
      const userData = userDoc.data();
      const userId = userDoc.id;
      
      console.log(`Processing user: ${userData.email || userId}`);
      
      // Check if user already has an organization
      if (userData.organizationId) {
        console.log(`User ${userId} already has organizationId: ${userData.organizationId}, skipping...`);
        continue;
      }
      
      // Create a personal organization for the user
      const orgName = userData.displayName || userData.email.split('@')[0];
      const orgSlug = `${orgName.replace(/\s+/g, '-').toLowerCase()}-${userId.substring(0, 8)}`;
      
      const newOrganization = {
        name: `${orgName}'s Personal Organization`,
        slug: orgSlug,
        ownerId: userId,
        adminIds: [userId],
        members: [{
          userId: userId,
          email: userData.email,
          displayName: userData.displayName,
          photoURL: userData.photoURL || null,
          role: 'owner',
          joinedAt: admin.firestore.FieldValue.serverTimestamp(),
        }],
        settings: {
          theme: 'light',
          language: 'en',
          notifications: {
            email: true,
            push: true,
          },
        },
        subscription: {
          status: userData.subscription?.status || 'trial',
          tier: userData.subscription?.tier || null,
          billingCycle: userData.subscription?.billingCycle || null,
          stripeCustomerId: userData.subscription?.stripeCustomerId || null,
          stripeSubscriptionId: userData.subscription?.stripeSubscriptionId || null,
          currentPeriodStart: userData.subscription?.currentPeriodStart || null,
          currentPeriodEnd: userData.subscription?.currentPeriodEnd || null,
          trialStartDate: userData.subscription?.trialStartDate || admin.firestore.FieldValue.serverTimestamp(),
          trialEndDate: userData.subscription?.trialEndDate || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          cancelAtPeriodEnd: userData.subscription?.cancelAtPeriodEnd || false,
        },
        metrics: {
          totalMembers: 1,
          totalProjects: 0,
          totalTasks: 0,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      
      // Create the organization in Firestore
      const orgRef = await db.collection('organizations').add(newOrganization);
      const organizationId = orgRef.id;
      
      console.log(`Created organization ${organizationId} for user ${userId}`);
      
      // Update the user document with the organizationId
      await db.collection('users').doc(userId).update({
        organizationId: organizationId,
        organizationRole: 'owner',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      
      // Update all projects belonging to this user to include organizationId
      const userProjectsSnapshot = await db.collection('projects')
        .where('ownerId', '==', userId)
        .get();
      
      let projectCount = 0;
      for (const projectDoc of userProjectsSnapshot.docs) {
        await db.collection('projects').doc(projectDoc.id).update({
          organizationId: organizationId,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        projectCount++;
      }
      
      // Update the organization metrics with project count
      await db.collection('organizations').doc(organizationId).update({
        'metrics.totalProjects': projectCount,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      
      console.log(`Updated ${projectCount} projects for user ${userId} with organizationId`);
      
      // Update all tasks created by this user to include organizationId
      const userTasksSnapshot = await db.collection('tasks')
        .where('createdBy', '==', userId)
        .get();
      
      let taskCount = 0;
      for (const taskDoc of userTasksSnapshot.docs) {
        await db.collection('tasks').doc(taskDoc.id).update({
          organizationId: organizationId,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        taskCount++;
      }
      
      // Update the organization metrics with task count
      await db.collection('organizations').doc(organizationId).update({
        'metrics.totalTasks': admin.firestore.FieldValue.increment(taskCount),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      
      console.log(`Updated ${taskCount} tasks for user ${userId} with organizationId`);
      
      // Update all comments created by this user to include organizationId
      const userCommentsSnapshot = await db.collection('comments')
        .where('userId', '==', userId)
        .get();
      
      for (const commentDoc of userCommentsSnapshot.docs) {
        await db.collection('comments').doc(commentDoc.id).update({
          organizationId: organizationId,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      
      console.log(`Updated comments for user ${userId} with organizationId`);
    }
    
    console.log('Migration completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  }
}

// Run the migration
migrateUsersToOrganizations()
  .then(() => {
    console.log('Script completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Script failed:', error);
    process.exit(1);
  });