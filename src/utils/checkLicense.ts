import chalk from 'chalk';

export default () => {
  console.log(chalk.bgBlue(`\nYou are using a free version of this plugin`));
  console.log(
    chalk.blueBright(
      `This plugin is governed and published under the AGPL-3.0 copy-left license. \nIf using for commercial purposes or proprietary software, please contact hello@eventcatalog.dev for a license to support the project.`
    )
  );
};
