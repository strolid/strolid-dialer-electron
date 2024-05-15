We have automated the build of electron app using GitHub Actions. When we are ready to release a new version, say 1.0.6, we can execute "./release.sh 1.0.6" in our local file system. This command will
-Automatically update version in package.json and package-lock.json and commits it
-Automatically tags that commit and pushes the tag, this step will trigger GitHub action to release new artifacts.