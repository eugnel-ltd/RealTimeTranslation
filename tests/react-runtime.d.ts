// The hook harness imports the client's React instance so App shares its dispatcher.
// Give that explicit runtime path the same public types as the normal React import.
declare module '*client/node_modules/react' {
  import React from 'react';
  export default React;
}
