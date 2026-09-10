from pathlib import Path

import yaml


TEMPLATE_PATH = Path(__file__).resolve().parents[2] / "template.yaml"


class CloudFormationLoader(yaml.SafeLoader):
    pass


def _construct_cloudformation_tag(loader, tag_suffix, node):
    key = {
        "Ref": "Ref",
        "Sub": "Fn::Sub",
        "GetAtt": "Fn::GetAtt",
        "Equals": "Fn::Equals",
        "Not": "Fn::Not",
        "If": "Fn::If",
    }[tag_suffix]
    if isinstance(node, yaml.ScalarNode):
        value = loader.construct_scalar(node)
    else:
        value = loader.construct_sequence(node)
    return {key: value}


CloudFormationLoader.add_multi_constructor("!", _construct_cloudformation_tag)


def _load_template():
    return yaml.load(TEMPLATE_PATH.read_text(encoding="utf-8"), Loader=CloudFormationLoader)


def _resolved_reserved_concurrency(template, parameter_value):
    condition = template["Conditions"]["UseProcessorReservedConcurrency"]
    assert condition == {
        "Fn::Not": [
            {
                "Fn::Equals": [
                    {"Ref": "ProcessorReservedConcurrency"},
                    0,
                ]
            }
        ]
    }

    configured_value = template["Resources"]["CameraProcessorFunction"]["Properties"][
        "ReservedConcurrentExecutions"
    ]
    assert configured_value == {
        "Fn::If": [
            "UseProcessorReservedConcurrency",
            {"Ref": "ProcessorReservedConcurrency"},
            {"Ref": "AWS::NoValue"},
        ]
    }

    use_reservation = parameter_value != 0
    selected = configured_value["Fn::If"][1 if use_reservation else 2]
    if selected == {"Ref": "AWS::NoValue"}:
        return None
    assert selected == {"Ref": "ProcessorReservedConcurrency"}
    return parameter_value


def test_zero_omits_processor_reserved_concurrency():
    template = _load_template()
    parameter = template["Parameters"]["ProcessorReservedConcurrency"]

    assert parameter["Default"] == 0
    assert parameter["MinValue"] == 0
    assert _resolved_reserved_concurrency(template, 0) is None


def test_positive_value_configures_processor_reserved_concurrency():
    template = _load_template()

    assert _resolved_reserved_concurrency(template, 2) == 2
