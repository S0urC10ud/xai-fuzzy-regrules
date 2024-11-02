const path = require('path');
const webpack = require('webpack');

module.exports = {
  mode: 'development',
  entry: './src/browser/index.ts',
  output: {
    filename: 'bundle.js',
    path: path.resolve(__dirname, 'dist'),
  },
  target: 'web',
  resolve: {
    extensions: ['.ts', '.js'],
    fallback: {
      buffer: require.resolve('buffer'),
      fs: false,
      path: false
    },
  },
  plugins: [
    new webpack.ProvidePlugin({
      Buffer: ['buffer', 'Buffer'], // Automatically provide Buffer globally
    }),
    new webpack.DefinePlugin({
      'process.env.IS_BACKEND': JSON.stringify(false)
    })
  ],
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
};
