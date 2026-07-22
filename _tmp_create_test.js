require('dotenv').config();
(async () => {
  try {
    const models = require('./models');
    const { DestinationComment, Destination, User } = models;
    console.log('Models loaded:', {
      DestinationComment: !!DestinationComment,
      Destination: !!Destination,
      User: !!User,
    });

    // find a real destination + user
    const dest = await Destination.findOne();
    const user = await User.findOne();
    console.log('sample destination:', dest ? { id: dest.id, name: dest.name } : null);
    console.log('sample user:', user ? { id: user.id } : null);

    if (!dest) { console.log('NO DESTINATIONS — comments impossible'); process.exit(0); }

    // Try the include query used by getComments
    try {
      const USER_INCLUDE = { model: User, as: 'user', attributes: ['id','fullName','email','avatarUrl'], required: false };
      const r = await DestinationComment.findAndCountAll({
        where: { destinationId: dest.id, parentId: null },
        include: [ { model: DestinationComment, as: 'replies', include: [USER_INCLUDE] }, USER_INCLUDE ],
        order: [['createdAt','DESC'], [{ model: DestinationComment, as: 'replies' }, 'createdAt','ASC']],
        limit: 50, offset: 0, distinct: true,
      });
      console.log('getComments query OK, count=', r.count);
    } catch (e) {
      console.error('getComments query FAILED:', e.message);
    }

    // Try create
    try {
      const created = await DestinationComment.create({
        destinationId: dest.id,
        userId: user ? user.id : null,
        content: 'diagnostic test comment ' + Date.now(),
        parentId: null,
        authorName: user ? null : 'Anonymous',
        isApproved: true,
      });
      console.log('CREATE OK, id=', created.id);
      // clean up
      await created.destroy();
      console.log('cleanup done');
    } catch (e) {
      console.error('CREATE FAILED:', e.message);
    }
  } catch (e) {
    console.error('TOP-LEVEL ERR:', e.message);
    console.error(e.stack);
  }
  process.exit(0);
})();
