const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const webpack = require('webpack');

module.exports = {
  entry: './src/client/index.tsx',
  output: {
    path: path.resolve(__dirname, 'public'),
    filename: 'bundle.js',
    publicPath: '/',
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        loader: 'esbuild-loader',
        // `jsx: 'automatic'` mirrors `jsx: "react-jsx"` in tsconfig.json so no
        // explicit React import is needed in each file. esbuild does NOT
        // type-check - `npm run typecheck` covers that (run in CI).
        options: { target: 'es2020', jsx: 'automatic' },
        exclude: /node_modules/,
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
      {
        test: /\.mjs$/,
        include: /node_modules/,
        type: 'javascript/auto',
        resolve: { fullySpecified: false },
      },
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './src/client/index.html',
      filename: 'index.html',
    }),
    new webpack.DefinePlugin({
      APP_VERSION: JSON.stringify(process.env.APP_VERSION || 'dev'),
    }),
  ],
  devServer: {
    static: { directory: path.join(__dirname, 'public') },
    port: 8080,
    hot: true,
    historyApiFallback: true,
    proxy: [
      {
        context: ['/api'],
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    ],
  },
};
