local claims = std.extVar('claims');
{
  identity: {
    traits: {
      [if 'email' in claims then 'email']: claims.email,
      name: {
        [if 'given_name' in claims then 'first']: claims.given_name,
        [if 'family_name' in claims then 'last']: claims.family_name,
      },
    },
  },
}
