import chalk from 'chalk';

export default () => {
  console.log(chalk.bgBlue(`\nYou are using the open source license for this plugin`));
  console.log(
    chalk.blueBright(
      `This plugin is governed and published under a dual-license. \nIf using for commercial or proprietary software, please contact hello@eventcatalog.dev for a license to support the project.`
    )
  );
};
