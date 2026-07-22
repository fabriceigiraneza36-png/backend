require('dotenv').config();
const models = require('./models');
const { DestinationComment, Destination, User } = models;

const assoc = DestinationComment.associations || {};
console.log('DestinationComment associations:', Object.keys(assoc));
console.log('  has replies?', !!assoc.replies);
console.log('  has user?', !!assoc.user);
console.log('  has destination?', !!assoc.destination);
console.log('User associations:', Object.keys(User.associations || {}));
console.log('Destination associations:', Object.keys(Destination.associations || {}));

// Try to generate the SQL for the getComments include (does NOT hit DB)
try {
  const USER_INCLUDE = { model: User, as: 'user', attributes: ['id','fullName','email','avatarUrl'], required: false };
  const q = DestinationComment.QueryGenerator ? 'has QG' : 'no QG';
  // Build findAll options and let sequelize validate includes
  const Model = DestinationComment;
  const opts = Model._validateIncludedElements
    ? Model._validateIncludedElements({
        include: [
          { model: DestinationComment, as: 'replies', include: [USER_INCLUDE] },
          USER_INCLUDE,
        ],
        model: Model,
      })
    : null;
  console.log('include validation: OK');
} catch (e) {
  console.error('include validation FAILED:', e.message);
}
process.exit(0);
