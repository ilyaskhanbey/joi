'use strict';

const Fs = require('fs');

const { assert } = require('@hapi/hoek');
const Benchmark = require('benchmark');
const Bossy = require('@hapi/bossy');
const Chalk = require('chalk');
const CliTable = require('cli-table');
const D3 = require('d3-format');


const definition = {
    c: {
        alias: 'compare',
        type: 'string'
    },
    s: {
        alias: 'save',
        type: 'string'
    },
    t: {
        alias: 'threshold',
        type: 'number',
        default: 10
    },
    j: {
        alias: 'joi',
        type: 'string',
        default: '..'
    }
};

const args = Bossy.parse(definition);

let compare;
if (args.compare) {
    try {
        compare = JSON.parse(Fs.readFileSync(args.compare, 'utf8'));
    }
    catch {
        // Ignore error
    }
}

const formats = {
    number: D3.format(',d'),
    percentage: D3.format('.2f'),
    integer: D3.format(',')
};

Benchmark.options.minSamples = 100;

const Joi = require(args.joi);

const Suite = new Benchmark.Suite('joi');

const versionPick = (o) => {

    if (typeof o === 'function') {
        return o;
    }

    for (const k of Object.keys(o)) {
        if (Joi.version.startsWith(k)) {
            return o[k];
        }
    }

    throw new Error(`Unsupported version ${Joi.version}`);
};

const test = ([name, initFn, testFn]) => {

    const [schema, valid, invalid] = versionPick(initFn)();

    assert(valid === undefined || !testFn(schema, valid).error, 'validation must not fail for: ' + name);
    assert(invalid === undefined || testFn(schema, invalid).error, 'validation must fail for: ' + name);

    testFn = versionPick(testFn);
    Suite.add(name + (valid !== undefined ? ' (valid)' : ''), () => {

        testFn(schema, valid);
    });

    if (invalid !== undefined) {
        Suite.add(name + ' (invalid)', () => {

            testFn(schema, invalid);
        });
    }
};

require('./suite')(Joi).forEach(test);

Suite
    .on('complete', (benches) => {

        const report = benches.currentTarget.map((bench) => {

            const { name, hz, stats, error } = bench;
            return { name, hz, rme: stats.rme, size: stats.sample.length, error };
        });

        if (args.save) {
            Fs.writeFileSync(args.save, JSON.stringify(report, null, 2), 'utf8');
        }

        const tableDefinition = {
            head: [Chalk.blue('Name'), '', Chalk.yellow('Ops/sec'), Chalk.yellow('MoE'), Chalk.yellow('Sample size')],
            colAligns: ['left', '', 'right', 'right', 'right']
        };

        if (compare) {
            tableDefinition.head.push('', Chalk.cyan('Previous ops/sec'), Chalk.cyan('Previous MoE'), Chalk.cyan('Previous sample size'), '', Chalk.whiteBright('% difference'));
            tableDefinition.colAligns.push('', 'right', 'right', 'right', '', 'right');
        }

        const table = new CliTable(tableDefinition);

        table.push(...report.map((s) => {

            const row = [
                s.error ? Chalk.redBright(s.name) : s.name,
                '',
                formats.number(s.hz),
                `± ${formats.percentage(s.rme)} %`,
                formats.integer(s.size)
            ];

            if (compare) {
                const previousRun = compare.find((run) => run.name === s.name);
                if (previousRun) {
                    const difference = s.hz - previousRun.hz;
                    const percentage = 100 * difference / previousRun.hz;
                    const isSignificant = Math.abs(percentage) > args.threshold;
                    const formattedDifference = `${percentage > 0 ? '+' : ''}${formats.percentage(percentage)} %`;
                    row.push(
                        '',
                        formats.number(previousRun.hz),
                        `± ${formats.percentage(previousRun.rme)} %`,
                        formats.integer(previousRun.size),
                        '',
                        isSignificant
                            ? Chalk[difference > 0 ? 'green' : 'red'](formattedDifference)
                            : formattedDifference
                    );
                }
            }

            return row;
        }));

        console.log(table.toString());

        const errors = report.filter((s) => s.error);
        if (errors.length) {
            console.log(Chalk.redBright.underline.bold('\nErrors:'));
            console.log(errors.map((e) => `> ${Chalk.italic(e.name)}\n${e.error.stack}`).join('\n'));
        }
    });

Suite.run();
