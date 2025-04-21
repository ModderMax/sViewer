The server files should be placed in the same directory as your live_output folder.

Install nodejs
Run install-dependencies.bat to make sure all dependencies are present
Open the terminal in the server's directory and use `node server.js` to start the server 
Run HWiNFO server on port 8085
Run satdump server on port 8081

Files in the /Public/ directory will be served and run client-side
Files in the /Routes/ directory are run locally, and will handle requests and push updates to the client
Server.js sets up the local environment, main.js sets up the client-side environment
Files in /Scripts/ can make changes the server-side environment, and should have requests sent to them directly from a client, they must be sent through an API in /Routes/
A /data/ directory will be created for storing SQLite database files

=====Known Issues=====

If a pass is populating in the live_output folder and the an update is called, that pass may be entered into the database without proper metadata and list of images, since only an 'update' is called which skips entries that are already found, this will not be automatically fixed and a --rebuild or --repopulate call will need to be made.

Composite types are a static array, if you have SatDump creating composites that are not listed in the COMPOSITE_TYPES under /routes/api.js they will not appear. In the future this list will be compiled automatically
