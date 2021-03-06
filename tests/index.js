const path = require('path');
const sinon = require('sinon');
const chai = require('chai');
const ServerlessSesTemplate = require('../index');

const { expect } = chai;

const defaultService = {
    provider: {
        name: 'aws',
        region: 'us-west-2',
        stage: 'dev',
        alias: 'production',
    },
    custom: { sesTemplatesConfigFile: null, sesTemplatesAddStageAlias: null, sesTemplatesRegion: null },
};
const mockServerless = (command, service = defaultService, providerMock = () => {}) => ({
    service,
    processedInput: { commands: ['ses-template', command] },
    config: { servicePath: path.join(__dirname, '..') },
    getProvider: (name) => providerMock(name),
    utils: {
        fileExistsSync: sinon.spy(() => true),
    },
    classes: {
        Error: sinon.spy((message) => {
            throw new Error(message);
        }),
    },
    cli: {
        log: sinon.spy(),
    },
});

describe('The `ses-template` plugin', () => {
    it('Exports a constructor function', () => {
        expect(ServerlessSesTemplate).to.be.a('function');
    });

    it('Validates service provider', () => {
        const slsMock = mockServerless('deploy', { provider: { name: 'unknown' } });
        try {
            new ServerlessSesTemplate(slsMock); // eslint-disable-line no-new
            expect.fail(
                'unknown is valid provider',
                'unknown is invalid provider',
                'ServerlessSesTemplate does check service provider',
            );
        } catch (err) {
            expect(err).to.be.an('Error');
            expect(slsMock.classes.Error.calledOnce).to.be.true;
            expect(err.message).to.be.equal('ses-template plugin supports only AWS');
        }
    });

    it('Validates configuration file', (done) => {
        const serviceConfig = {
            ...defaultService,
            custom: {
                sesTemplatesConfigFile: 'file-not-exist-name.js',
            },
        };
        const slsMock = {
            service: serviceConfig,
            processedInput: { commands: ['ses-template', 'deploy'] },
            config: { servicePath: path.join(__dirname, '..') },
            getProvider: () => {},
            utils: {
                fileExistsSync: sinon.spy(() => false),
            },
            classes: {
                Error: sinon.spy((message) => {
                    throw new Error(message);
                }),
            },
            cli: {
                log: sinon.spy(),
            },
        };
        const pluginInstance = new ServerlessSesTemplate(slsMock);

        const syncPromise = pluginInstance.hooks['ses-template:deploy:syncTemplates']();
        syncPromise.then(() => {
            done(new Error('Configuration path not validated.'));
        },
        (err) => {
            expect(err.message).to.include('SES email templates configuration file not found by path');
            expect(slsMock.cli.log.callCount).to.equal(1);
            done();
        });
    });

    describe('The constructed object', () => {
        let pluginInstance;
        beforeEach(() => {
            pluginInstance = new ServerlessSesTemplate(mockServerless('list'));
        });
        it('Exposes correct list of hooks', () => {
            expect(pluginInstance.hooks).to.be.an('object');
            expect(Object.keys(pluginInstance.hooks)).to.be.lengthOf(4);
            expect(pluginInstance.hooks['ses-template:deploy:syncTemplates']).to.be.a('function');
            expect(pluginInstance.hooks['ses-template:delete:deleteGiven']).to.be.a('function');
            expect(pluginInstance.hooks['ses-template:list:list']).to.be.a('function');
            expect(pluginInstance.hooks['before:package:initialize']).to.be.a('function');
        });
        it('Exposes correct list of commands', () => {
            expect(pluginInstance.commands).to.be.an('object');
            expect(Object.keys(pluginInstance.commands)).to.be.lengthOf(1);
            expect(pluginInstance.commands['ses-template']).to.be.a('object');
            expect(pluginInstance.commands['ses-template']).deep.property('usage');
            expect(pluginInstance.commands['ses-template']).deep.property('lifecycleEvents');
            expect(pluginInstance.commands['ses-template']).deep.property('commands');
            expect(pluginInstance.commands['ses-template']).deep.property('commands');
            expect(pluginInstance.commands['ses-template'].commands).deep.property('deploy');
            expect(pluginInstance.commands['ses-template'].commands).deep.property('delete');
            expect(pluginInstance.commands['ses-template'].commands).deep.property('list');
            expect(pluginInstance.commands['ses-template']).deep.property('options');
        });
    });

    describe('Fresh deploy with no custom properties', () => {
        let serverless;
        let pluginInstance;
        const requestStub = sinon.stub();
        requestStub.onCall(0).resolves({ TemplatesMetadata: [{ Name: 'template-id' }] });
        requestStub.onCall(1).resolves();
        const providerSpy = sinon.spy(() => ({
            request: requestStub,
        }));
        before(() => {
            serverless = mockServerless('deploy', defaultService, providerSpy);
            pluginInstance = new ServerlessSesTemplate(serverless);
        });
        describe('When the `ses-template:deploy:syncTemplates` hook is executed', () => {
            before(() => {
                pluginInstance.hooks['ses-template:deploy:syncTemplates']();
            });
            it('Provider does requests to AWS SES', () => {
                expect(requestStub.callCount).to.be.equal(2);
            });
            it('Loads templates from SES executes', () => {
                expect(requestStub.getCall(0).args[0]).to.be.equal('SES');
                expect(requestStub.getCall(0).args[1]).to.be.equal('listTemplates');
                expect(requestStub.getCall(0).args[2]).to.be.deep.equal({
                    MaxItems: 10,
                    NextToken: undefined,
                });
                expect(requestStub.getCall(0).args[3]).to.be.deep.equal({ stage: 'dev', region: 'us-west-2' });
            });
            it('Creates template resource', () => {
                expect(requestStub.getCall(1).args[0]).to.be.equal('SES');
                expect(requestStub.getCall(1).args[1]).to.be.equal('createTemplate');
                expect(requestStub.getCall(1).args[2]).to.be.deep.equal({
                    Template: {
                        TemplateName: 'example',
                        SubjectPart: 'example',
                        HtmlPart: '<div>Hello world!</div>\n',
                        TextPart: 'Hello world!\n',
                    },
                });
                expect(requestStub.getCall(1).args[3]).to.be.deep.equal({ stage: 'dev', region: 'us-west-2' });
            });
            it('Logs messages', () => {
                expect(serverless.cli.log.callCount).to.equal(3);
            });
        });
    });

    describe('Fresh deploy with --removeMissed and --sesTemplatesRegion', () => {
        let serverless;
        let pluginInstance;
        const requestStub = sinon.stub();
        requestStub.onCall(0).resolves({ TemplatesMetadata: [{ Name: 'template-id' }] });
        requestStub.onCall(1).resolves();
        requestStub.onCall(2).resolves();
        const providerSpy = sinon.spy(() => ({
            request: requestStub,
        }));
        before(() => {
            serverless = mockServerless('deploy', defaultService, providerSpy);
            pluginInstance = new ServerlessSesTemplate(serverless, {
                removeMissed: true,
                sesTemplatesRegion: 'us-east-1',
            });
        });
        describe('When the `ses-template:deploy:syncTemplates` hook is executed', () => {
            before(() => {
                pluginInstance.hooks['ses-template:deploy:syncTemplates']();
            });
            it('Provider does requests to AWS SES', () => {
                expect(requestStub.callCount).to.be.equal(3);
            });
            it('Loads templates from SES executes', () => {
                expect(requestStub.getCall(0).args[0]).to.be.equal('SES');
                expect(requestStub.getCall(0).args[1]).to.be.equal('listTemplates');
                expect(requestStub.getCall(0).args[2]).to.be.deep.equal({
                    MaxItems: 10,
                    NextToken: undefined,
                });
                expect(requestStub.getCall(0).args[3]).to.be.deep.equal({ stage: 'dev', region: 'us-east-1' });
            });
            it('Creates template resource', () => {
                expect(requestStub.getCall(1).args[0]).to.be.equal('SES');
                expect(requestStub.getCall(1).args[1]).to.be.equal('createTemplate');
                expect(requestStub.getCall(1).args[2]).to.be.deep.equal({
                    Template: {
                        TemplateName: 'example',
                        SubjectPart: 'example',
                        HtmlPart: '<div>Hello world!</div>\n',
                        TextPart: 'Hello world!\n',
                    },
                });
                expect(requestStub.getCall(1).args[3]).to.be.deep.equal({ stage: 'dev', region: 'us-east-1' });
            });
            it('Removes missed template resource', () => {
                expect(requestStub.getCall(2).args[0]).to.be.equal('SES');
                expect(requestStub.getCall(2).args[1]).to.be.equal('deleteTemplate');
                expect(requestStub.getCall(2).args[2]).to.be.deep.equal({
                    TemplateName: 'template-id',
                });
                expect(requestStub.getCall(2).args[3]).to.be.deep.equal({ stage: 'dev', region: 'us-east-1' });
            });
            it('Logs messages', () => {
                expect(serverless.cli.log.callCount).to.equal(4);
            });
        });
    });

    describe('Repeated deploy with no custom properties', () => {
        let serverless;
        let pluginInstance;
        const requestStub = sinon.stub();
        requestStub.onCall(0).resolves({ TemplatesMetadata: [{ Name: 'example' }] });
        requestStub.onCall(1).resolves();
        const providerSpy = sinon.spy(() => ({
            request: requestStub,
        }));
        before(() => {
            serverless = mockServerless('deploy', defaultService, providerSpy);
            pluginInstance = new ServerlessSesTemplate(serverless);
        });
        describe('When the `ses-template:deploy:syncTemplates` hook is executed', () => {
            before(() => {
                pluginInstance.hooks['ses-template:deploy:syncTemplates']();
            });
            it('Provider does requests to AWS SES', () => {
                expect(requestStub.callCount).to.be.equal(2);
            });
            it('Loads templates from SES executes', () => {
                expect(requestStub.getCall(0).args[0]).to.be.equal('SES');
                expect(requestStub.getCall(0).args[1]).to.be.equal('listTemplates');
                expect(requestStub.getCall(0).args[2]).to.be.deep.equal({
                    MaxItems: 10,
                    NextToken: undefined,
                });
                expect(requestStub.getCall(0).args[3]).to.be.deep.equal({ stage: 'dev', region: 'us-west-2' });
            });
            it('Updates template resource', () => {
                expect(requestStub.getCall(1).args[0]).to.be.equal('SES');
                expect(requestStub.getCall(1).args[1]).to.be.equal('updateTemplate');
                expect(requestStub.getCall(1).args[2]).to.be.deep.equal({
                    Template: {
                        TemplateName: 'example',
                        SubjectPart: 'example',
                        HtmlPart: '<div>Hello world!</div>\n',
                        TextPart: 'Hello world!\n',
                    },
                });
                expect(requestStub.getCall(1).args[3]).to.be.deep.equal({ stage: 'dev', region: 'us-west-2' });
            });
            it('Logs messages', () => {
                expect(serverless.cli.log.callCount).to.equal(3);
            });
        });
    });

    describe('Deploy templates with invalid region', () => {
        let serverless;
        let pluginInstance;
        const requestStub = sinon.stub();
        const providerSpy = sinon.spy(() => ({
            request: requestStub,
        }));
        before(() => {
            serverless = mockServerless('deploy', defaultService, providerSpy);
            pluginInstance = new ServerlessSesTemplate(serverless, { region: 'invalid' });
        });
        describe('When the `ses-template:deploy:syncTemplates` hook is executed', () => {
            before(() => {
                pluginInstance.hooks['ses-template:deploy:syncTemplates']();
            });
            it('Provider does not request AWS SES', () => {
                expect(requestStub.callCount).to.be.equal(0);
            });
            it('Logs messages', () => {
                expect(serverless.cli.log.callCount).to.equal(2);
            });
        });
    });

    describe('Fresh deploy with stage and alias option enabled', () => {
        let serverless;
        let pluginInstance;
        const requestStub = sinon.stub();
        requestStub.onCall(0).resolves({ TemplatesMetadata: [{ Name: 'template-id' }] });
        requestStub.onCall(1).resolves();
        const providerSpy = sinon.spy(() => ({
            request: requestStub,
        }));
        before(() => {
            serverless = mockServerless('deploy', defaultService, providerSpy);
            serverless.service.custom.sesTemplatesAddStageAlias = true;
            pluginInstance = new ServerlessSesTemplate(serverless);
        });
        describe('When the `ses-template:deploy:syncTemplates` hook is executed', () => {
            before(() => {
                pluginInstance.hooks['ses-template:deploy:syncTemplates']();
            });
            it('Provider does requests to AWS SES', () => {
                expect(requestStub.callCount).to.be.equal(2);
            });
            it('Loads templates from SES executes', () => {
                expect(requestStub.getCall(0).args[0]).to.be.equal('SES');
                expect(requestStub.getCall(0).args[1]).to.be.equal('listTemplates');
                expect(requestStub.getCall(0).args[2]).to.be.deep.equal({
                    MaxItems: 10,
                    NextToken: undefined,
                });
                expect(requestStub.getCall(0).args[3]).to.be.deep.equal({ stage: 'dev', region: 'us-west-2' });
            });
            it('Creates template resource', () => {
                expect(requestStub.getCall(1).args[0]).to.be.equal('SES');
                expect(requestStub.getCall(1).args[1]).to.be.equal('createTemplate');
                expect(requestStub.getCall(1).args[2]).to.be.deep.equal({
                    Template: {
                        TemplateName: 'example_dev_production',
                        SubjectPart: 'example',
                        HtmlPart: '<div>Hello world!</div>\n',
                        TextPart: 'Hello world!\n',
                    },
                });
                expect(requestStub.getCall(1).args[3]).to.be.deep.equal({ stage: 'dev', region: 'us-west-2' });
            });
            it('Logs messages', () => {
                expect(serverless.cli.log.callCount).to.equal(3);
            });
        });
    });

    describe('Fresh deploy with stage but no alias', () => {
        let serverless;
        let pluginInstance;
        const requestStub = sinon.stub();
        requestStub.onCall(0).resolves({ TemplatesMetadata: [{ Name: 'template-id' }] });
        requestStub.onCall(1).resolves();
        const providerSpy = sinon.spy(() => ({
            request: requestStub,
        }));
        before(() => {
            serverless = mockServerless('deploy', defaultService, providerSpy);
            serverless.service.provider.alias = undefined;
            serverless.service.custom.sesTemplatesAddStageAlias = true;
            pluginInstance = new ServerlessSesTemplate(serverless);
        });
        describe('When the `ses-template:deploy:syncTemplates` hook is executed', () => {
            before(() => {
                pluginInstance.hooks['ses-template:deploy:syncTemplates']();
            });
            it('Provider does requests to AWS SES', () => {
                expect(requestStub.callCount).to.be.equal(2);
            });
            it('Loads templates from SES executes', () => {
                expect(requestStub.getCall(0).args[0]).to.be.equal('SES');
                expect(requestStub.getCall(0).args[1]).to.be.equal('listTemplates');
                expect(requestStub.getCall(0).args[2]).to.be.deep.equal({
                    MaxItems: 10,
                    NextToken: undefined,
                });
                expect(requestStub.getCall(0).args[3]).to.be.deep.equal({ stage: 'dev', region: 'us-west-2' });
            });
            it('Creates template resource', () => {
                expect(requestStub.getCall(1).args[0]).to.be.equal('SES');
                expect(requestStub.getCall(1).args[1]).to.be.equal('createTemplate');
                expect(requestStub.getCall(1).args[2]).to.be.deep.equal({
                    Template: {
                        TemplateName: 'example_dev',
                        SubjectPart: 'example',
                        HtmlPart: '<div>Hello world!</div>\n',
                        TextPart: 'Hello world!\n',
                    },
                });
                expect(requestStub.getCall(1).args[3]).to.be.deep.equal({ stage: 'dev', region: 'us-west-2' });
            });
            it('Logs messages', () => {
                expect(serverless.cli.log.callCount).to.equal(3);
            });
        });
    });

    describe('Delete template with correct values', () => {
        let serverless;
        let pluginInstance;
        const requestStub = sinon.stub();
        requestStub.onCall(0).resolves({ TemplatesMetadata: [{ Name: 'example' }] });
        requestStub.onCall(1).resolves();
        const providerSpy = sinon.spy(() => ({
            request: requestStub,
        }));
        before(() => {
            serverless = mockServerless('delete', defaultService, providerSpy);
            pluginInstance = new ServerlessSesTemplate(serverless, { template: 'template-name' });
        });
        describe('When the `ses-template:delete:deleteGiven` hook is executed', () => {
            before(() => {
                pluginInstance.hooks['ses-template:delete:deleteGiven']();
            });
            it('Provider does requests to AWS SES', () => {
                expect(requestStub.callCount).to.be.equal(1);
            });
            it('Delete template from SES', () => {
                expect(requestStub.getCall(0).args[0]).to.be.equal('SES');
                expect(requestStub.getCall(0).args[1]).to.be.equal('deleteTemplate');
                expect(requestStub.getCall(0).args[2]).to.be.deep.equal({ TemplateName: 'template-name' });
                expect(requestStub.getCall(0).args[3]).to.be.deep.equal({ stage: 'dev', region: 'us-west-2' });
            });
            it('Logs messages', () => {
                expect(serverless.cli.log.callCount).to.equal(3);
            });
        });
    });

    describe('Delete template with invalid region', () => {
        let serverless;
        let pluginInstance;
        const requestStub = sinon.stub();
        const providerSpy = sinon.spy(() => ({
            request: requestStub,
        }));
        before(() => {
            serverless = mockServerless('delete', defaultService, providerSpy);
            pluginInstance = new ServerlessSesTemplate(serverless, { template: 'template-name', region: 'invalid' });
        });
        describe('When the `ses-template:delete:deleteGiven` hook is executed', () => {
            before(() => {
                pluginInstance.hooks['ses-template:delete:deleteGiven']();
            });
            it('Provider does not request AWS SES', () => {
                expect(requestStub.callCount).to.be.equal(0);
            });
            it('Logs messages', () => {
                expect(serverless.cli.log.callCount).to.equal(2);
            });
        });
    });

    describe('List templates with correct result', () => {
        let serverless;
        let loadTemplatesSpy;
        let pluginInstance;
        const requestStub = sinon.stub();
        requestStub.onCall(0).resolves({ TemplatesMetadata: [{ Name: 'example' }], NextToken: 'NextToken' });
        requestStub.onCall(1).resolves({ TemplatesMetadata: [{ Name: 'example2' }] });
        const providerSpy = sinon.spy(() => ({
            request: requestStub,
        }));
        before(() => {
            serverless = mockServerless('list', defaultService, providerSpy);
            loadTemplatesSpy = sinon.spy(ServerlessSesTemplate.prototype, 'loadTemplates');
            pluginInstance = new ServerlessSesTemplate(serverless, {});
        });
        describe('When the `ses-template:list:list` hook is executed', () => {
            before(() => {
                pluginInstance.hooks['ses-template:list:list']();
            });
            it('Provider does requests to AWS SES', () => {
                expect(requestStub.callCount).to.be.equal(2);
            });
            it('List templates from SES', () => {
                expect(requestStub.getCall(0).args[0]).to.be.equal('SES');
                expect(requestStub.getCall(0).args[1]).to.be.equal('listTemplates');
                expect(requestStub.getCall(0).args[2]).to.be.deep.equal({
                    MaxItems: 10, NextToken: undefined,
                });
                expect(requestStub.getCall(0).args[3]).to.be.deep.equal({ stage: 'dev', region: 'us-west-2' });
            });
            it('Template list returns correct result', (done) => {
                loadTemplatesSpy.returnValues[0].then((result) => {
                    expect(result).to.be.deep.equal([{ Name: 'example' }, { Name: 'example2' }]);
                    done();
                }).catch((error) => {
                    done(error);
                });
            });
            it('Logs messages', () => {
                expect(serverless.cli.log.callCount).to.equal(3);
            });
        });
        after(() => {
            loadTemplatesSpy.restore();
        });
    });

    describe('List templates with --filter parameter', () => {
        let serverless;
        let loadTemplatesSpy;
        let pluginInstance;
        const requestStub = sinon.stub();
        requestStub.onCall(0).resolves({ TemplatesMetadata: [{ Name: 'template name' }], NextToken: 'NextToken' });
        requestStub.onCall(1).resolves({ TemplatesMetadata: [{ Name: 'template to filter' }] });
        const providerSpy = sinon.spy(() => ({
            request: requestStub,
        }));
        before(() => {
            serverless = mockServerless('list', defaultService, providerSpy);
            loadTemplatesSpy = sinon.spy(ServerlessSesTemplate.prototype, 'loadTemplates');
            pluginInstance = new ServerlessSesTemplate(serverless, { filter: 'filter' });
        });
        describe('When the `ses-template:list:list` hook is executed', () => {
            before(() => {
                pluginInstance.hooks['ses-template:list:list']();
            });
            it('Provider does requests to AWS SES', () => {
                expect(requestStub.callCount).to.be.equal(2);
            });
            it('List templates from SES', () => {
                expect(requestStub.getCall(0).args[0]).to.be.equal('SES');
                expect(requestStub.getCall(0).args[1]).to.be.equal('listTemplates');
                expect(requestStub.getCall(0).args[2]).to.be.deep.equal({
                    MaxItems: 10, NextToken: undefined,
                });
                expect(requestStub.getCall(0).args[3]).to.be.deep.equal({ stage: 'dev', region: 'us-west-2' });
            });
            it('Template list uses filter', (done) => {
                loadTemplatesSpy.returnValues[0].then((result) => {
                    expect(result).to.be.deep.equal([{ Name: 'template to filter' }]);
                    done();
                }).catch((error) => {
                    done(error);
                });
            });
            it('Logs messages', () => {
                expect(serverless.cli.log.callCount).to.equal(3);
            });
        });
        after(() => {
            loadTemplatesSpy.restore();
        });
    });

    describe('List templates with empty result', () => {
        let serverless;
        let pluginInstance;
        const requestStub = sinon.stub();
        requestStub.onCall(0).resolves({ TemplatesMetadata: [] });
        const providerSpy = sinon.spy(() => ({
            request: requestStub,
        }));
        before(() => {
            serverless = mockServerless('list', defaultService, providerSpy);
            pluginInstance = new ServerlessSesTemplate(serverless, {});
        });
        describe('When the `ses-template:list:list` hook is executed', () => {
            before(() => {
                pluginInstance.hooks['ses-template:list:list']();
            });
            it('Provider does requests to AWS SES', () => {
                expect(requestStub.callCount).to.be.equal(1);
            });
            it('List templates from SES', () => {
                expect(requestStub.getCall(0).args[0]).to.be.equal('SES');
                expect(requestStub.getCall(0).args[1]).to.be.equal('listTemplates');
                expect(requestStub.getCall(0).args[2]).to.be.deep.equal({
                    MaxItems: 10, NextToken: undefined,
                });
                expect(requestStub.getCall(0).args[3]).to.be.deep.equal({ stage: 'dev', region: 'us-west-2' });
            });
            it('Logs messages', () => {
                expect(serverless.cli.log.callCount).to.equal(3);
            });
        });
    });

    describe('List templates with invalid region', () => {
        let serverless;
        let pluginInstance;
        const requestStub = sinon.stub();
        const providerSpy = sinon.spy(() => ({
            request: requestStub,
        }));
        before(() => {
            serverless = mockServerless('list', defaultService, providerSpy);
            pluginInstance = new ServerlessSesTemplate(serverless, { region: 'invalid' });
        });
        describe('When the `ses-template:list:list` hook is executed', () => {
            before(() => {
                pluginInstance.hooks['ses-template:list:list']();
            });
            it('Provider does not request AWS SES', () => {
                expect(requestStub.callCount).to.be.equal(0);
            });
            it('Logs messages', () => {
                expect(serverless.cli.log.callCount).to.equal(1);
            });
        });
    });
});
