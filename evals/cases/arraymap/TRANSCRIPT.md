# Array Map in 100 Seconds

- Channel: Fireship
- Published: 2019-12-17
- Duration: 01:40
- URL: https://www.youtube.com/watch?v=DC471a9qrU4
- Transcript: local whisper transcription (whisper)

[00:00] ArrayMap, create a new array by calling a function on every element in a different array. Imagine we have an array of squares. We can call a function on every single one of those squares using map to convert it to a new array of circles.

[00:13] In other words, it's just a loop, where the goal of that loop is to create a new array. In our code, let's start with an array of objects that contains some user data.

[00:21] Our goal is to take this array of objects and convert it to an array of strings that only contain the user names. We could do this imperatively by creating a new empty array, then use a for loop to push each individual username to the new array.

[00:33] Notice how we're using statements to change the app's state. This is known as imperative programming. Map on the other hand is declarative and describes how to create this new array using a function.

[00:44] The new array is equal to the original array mapped to a function. The function is passed as an argument to map, and it's called on every element in the original array.

[00:53] Our function has access to the current element in the loop as well as its index. In the body of the function, your job is to compute a new value and then return it.

[01:01] And we've now solved the same problem we did with the for loop, but with less code and without mutating the internal state. If you're a React.js user, you'll often see map use to take some initial data and then map it to JSX for the actual UI.

[01:13] Or maybe you need these user names to do something asynchronously like fetch additional data from the database. You could do that by mapping them all to an array of promises, then running them concurrently with promise.all.

[01:24] One anti-pattern to be aware of with map is that you should only use it if you plan on using the new array. If you just need to run a loop, consider for each, or a regular for loop instead.

[01:33] This has been ArrayMap in 100 seconds. Thanks for watching, and I will see you in the next one.
